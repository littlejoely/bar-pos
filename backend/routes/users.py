from __future__ import annotations

from datetime import datetime

from flask import Blueprint, g, jsonify, request
from sqlalchemy import or_, select

from auth.database import get_auth_session
from auth.middleware import require_permission
from auth.models import AuditLog, AuthSession, User
from auth.permissions import user_to_dict, utc_iso
from auth.security import hash_secret, validate_password, validate_short_account, validate_short_password
from auth.service import active_superadmin_count, audit, role_objects


users_bp = Blueprint('users', __name__)


def _is_superadmin(user: User) -> bool:
    return any(role.code == 'superadmin' for role in user.roles)


def _current_is_superadmin() -> bool:
    return _is_superadmin(g.current_user)


def _find_user_or_404(user_id: str):
    user = get_auth_session().get(User, user_id)
    if user is None or (_is_superadmin(user) and not _current_is_superadmin()):
        return None, (jsonify({'success': False, 'error': '用户不存在', 'code': 'USER_NOT_FOUND'}), 404)
    return user, None


@users_bp.get('')
@require_permission('user.view')
def list_users():
    db = get_auth_session()
    keyword = request.args.get('keyword', '').strip()
    statement = select(User).order_by(User.created_at.asc())
    if keyword:
        like = f'%{keyword}%'
        statement = statement.where(or_(
            User.display_name.like(like),
            User.username.like(like),
            User.employee_no.like(like),
            User.short_account.like(like),
        ))
    users = list(db.scalars(statement).all())
    if not _current_is_superadmin():
        users = [user for user in users if not _is_superadmin(user)]
    return jsonify({'success': True, 'data': [user_to_dict(user) for user in users], 'total': len(users)})


@users_bp.post('')
@require_permission('user.create')
def create_user():
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    if 'role.assign' not in g.current_permissions:
        return jsonify({'success': False, 'error': '没有分配角色的权限', 'code': 'PERMISSION_DENIED'}), 403
    username = str(payload.get('username', '')).strip()
    employee_no = str(payload.get('employee_no', '')).strip()
    short_account = str(payload.get('short_account', employee_no)).strip()
    display_name = str(payload.get('display_name', '')).strip()
    password = str(payload.get('password', ''))
    short_password = str(payload.get('short_password', payload.get('pin', '')))
    if not username or not employee_no or not display_name:
        return jsonify({'success': False, 'error': '姓名、账号和员工号均不能为空'}), 400
    if db.scalar(select(User).where(or_(
        User.username == username,
        User.employee_no == employee_no,
        User.short_account == short_account,
    ))):
        return jsonify({'success': False, 'error': '登录账号、员工号或短账号已存在'}), 409
    try:
        validate_password(password)
        validate_short_account(short_account)
        validate_short_password(short_password)
        role_codes = payload.get('role_codes') or []
        if 'superadmin' in role_codes and not _current_is_superadmin():
            return jsonify({'success': False, 'error': '无权分配超级管理员角色', 'code': 'PERMISSION_DENIED'}), 403
        roles = role_objects(db, role_codes)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    user = User(
        username=username,
        employee_no=employee_no,
        short_account=short_account,
        display_name=display_name,
        phone=str(payload.get('phone', '')).strip() or None,
        password_hash=hash_secret(password),
        pin_hash=hash_secret(short_password),
        status='active',
        must_change_password=True,
        data_scope='own_created' if getattr(g.current_user, 'data_scope', 'all') == 'own_created' else 'all',
        created_by_user_id=g.current_user.id,
        roles=roles,
    )
    db.add(user)
    db.flush()
    audit(db, request, action='user.create', module='user', user=g.current_user, resource_type='user', resource_id=user.id, after=user_to_dict(user, False))
    db.commit()
    return jsonify({'success': True, 'data': user_to_dict(user)}), 201


@users_bp.patch('/<user_id>')
@require_permission('user.edit')
def update_user(user_id: str):
    db = get_auth_session()
    user, error = _find_user_or_404(user_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    before = user_to_dict(user, False)
    if 'display_name' in payload:
        user.display_name = str(payload['display_name']).strip()
    if 'phone' in payload:
        user.phone = str(payload['phone']).strip() or None
    if 'username' in payload:
        username = str(payload['username']).strip()
        conflict = db.scalar(select(User).where(User.username == username, User.id != user.id))
        if not username or conflict:
            return jsonify({'success': False, 'error': '登录账号为空或已存在'}), 409
        user.username = username
    if 'employee_no' in payload:
        employee_no = str(payload['employee_no']).strip()
        conflict = db.scalar(select(User).where(User.employee_no == employee_no, User.id != user.id))
        if not employee_no or conflict:
            return jsonify({'success': False, 'error': '员工号为空或已存在'}), 409
        user.employee_no = employee_no
    if 'short_account' in payload:
        short_account = str(payload['short_account']).strip()
        try:
            validate_short_account(short_account)
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400
        conflict = db.scalar(select(User).where(User.short_account == short_account, User.id != user.id))
        if conflict:
            return jsonify({'success': False, 'error': '短账号已存在'}), 409
        user.short_account = short_account
    if 'role_codes' in payload:
        if 'role.assign' not in g.current_permissions:
            return jsonify({'success': False, 'error': '没有分配角色的权限', 'code': 'PERMISSION_DENIED'}), 403
        if 'superadmin' in payload['role_codes'] and not _current_is_superadmin():
            return jsonify({'success': False, 'error': '无权分配超级管理员角色', 'code': 'PERMISSION_DENIED'}), 403
        try:
            next_roles = role_objects(db, payload['role_codes'])
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400
        removes_superadmin = any(role.code == 'superadmin' for role in user.roles) and not any(role.code == 'superadmin' for role in next_roles)
        if removes_superadmin and active_superadmin_count(db, excluding_user_id=user.id) == 0:
            return jsonify({'success': False, 'error': '系统必须保留至少一名启用的超级管理员'}), 400
        user.roles = next_roles
    audit(db, request, action='user.edit', module='user', user=g.current_user, resource_type='user', resource_id=user.id, before=before, after=user_to_dict(user, False))
    db.commit()
    return jsonify({'success': True, 'data': user_to_dict(user)})


@users_bp.delete('/<user_id>')
@require_permission('user.delete')
def delete_user(user_id: str):
    db = get_auth_session()
    user, error = _find_user_or_404(user_id)
    if error:
        return error
    if user.id == g.current_user.id:
        return jsonify({'success': False, 'error': '不能删除当前登录账号'}), 400
    if _is_superadmin(user):
        return jsonify({'success': False, 'error': '超级管理员账号不能删除'}), 400
    business_record = db.scalar(select(AuditLog.id).where(
        AuditLog.user_id == user.id,
        AuditLog.result == 'success',
        AuditLog.module.not_in({'auth', 'user', 'role', 'audit'}),
    ).limit(1))
    if business_record:
        return jsonify({
            'success': False,
            'error': '该用户已产生业务记录，为保证审计可追溯，只能停用，不能删除',
            'code': 'USER_HAS_BUSINESS_RECORDS',
        }), 409
    before = user_to_dict(user, False)
    audit(
        db,
        request,
        action='user.delete',
        module='user',
        user=g.current_user,
        resource_type='user',
        resource_id=user.id,
        before=before,
    )
    db.delete(user)
    db.commit()
    return jsonify({'success': True})


@users_bp.post('/<user_id>/status')
@require_permission('user.disable')
def set_user_status(user_id: str):
    db = get_auth_session()
    user, error = _find_user_or_404(user_id)
    if error:
        return error
    status = str((request.get_json(silent=True) or {}).get('status', ''))
    if status not in {'active', 'disabled'}:
        return jsonify({'success': False, 'error': '无效的用户状态'}), 400
    if user.id == g.current_user.id and status == 'disabled':
        return jsonify({'success': False, 'error': '不能停用当前登录账号'}), 400
    if status == 'disabled' and _is_superadmin(user):
        return jsonify({'success': False, 'error': '超级管理员账号不能被停用'}), 400
    before = user.status
    user.status = status
    if status == 'disabled':
        now = datetime.utcnow()
        for auth_session in user.sessions:
            if auth_session.revoked_at is None:
                auth_session.revoked_at = now
    audit(db, request, action=f'user.{status}', module='user', user=g.current_user, resource_type='user', resource_id=user.id, before={'status': before}, after={'status': status})
    db.commit()
    return jsonify({'success': True, 'data': user_to_dict(user)})


@users_bp.post('/<user_id>/unlock')
@require_permission('user.edit')
def unlock_user(user_id: str):
    db = get_auth_session()
    user, error = _find_user_or_404(user_id)
    if error:
        return error
    user.failed_login_count = 0
    user.locked_until = None
    audit(db, request, action='user.unlock', module='user', user=g.current_user, resource_type='user', resource_id=user.id)
    db.commit()
    return jsonify({'success': True, 'data': user_to_dict(user)})


@users_bp.post('/<user_id>/reset-credentials')
@require_permission('user.reset_credential')
def reset_credentials(user_id: str):
    db = get_auth_session()
    user, error = _find_user_or_404(user_id)
    if error:
        return error
    target_is_superadmin = _is_superadmin(user)
    if target_is_superadmin and user.id != g.current_user.id:
        return jsonify({
            'success': False,
            'error': '超级管理员凭证只能由该超级管理员本人重置',
            'code': 'SUPERADMIN_CREDENTIAL_PROTECTED',
        }), 403
    payload = request.get_json(silent=True) or {}
    password = payload.get('password')
    short_password = payload.get('short_password', payload.get('pin'))
    if (password is None) == (short_password is None):
        return jsonify({'success': False, 'error': '每次必须且只能选择一种凭证进行重置'}), 400
    try:
        if password is not None:
            validate_password(str(password))
            user.password_hash = hash_secret(str(password))
            user.must_change_password = True
            if user.status == 'password_change_required':
                user.status = 'active'
        if short_password is not None:
            validate_short_password(str(short_password))
            user.pin_hash = hash_secret(str(short_password))
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    now = datetime.utcnow()
    for auth_session in user.sessions:
        if auth_session.revoked_at is None:
            auth_session.revoked_at = now
    audit(
        db,
        request,
        action='user.credential.reset',
        module='user',
        user=g.current_user,
        resource_type='user',
        resource_id=user.id,
        after={'credential_type': 'password' if password is not None else 'short_password'},
    )
    db.commit()
    return jsonify({'success': True, 'data': user_to_dict(user)})


@users_bp.get('/<user_id>/sessions')
@require_permission('user.session')
def user_sessions(user_id: str):
    user, error = _find_user_or_404(user_id)
    if error:
        return error
    sessions = sorted(user.sessions, key=lambda item: item.last_activity_at, reverse=True)[:50]
    data = [{
        'id': item.id,
        'login_method': item.login_method,
        'ip_address': item.ip_address,
        'user_agent': item.user_agent,
        'created_at': utc_iso(item.created_at),
        'last_activity_at': utc_iso(item.last_activity_at),
        'expires_at': utc_iso(item.expires_at),
        'locked': item.locked_at is not None,
        'active': item.revoked_at is None and item.expires_at > datetime.utcnow(),
    } for item in sessions]
    return jsonify({'success': True, 'data': data})


@users_bp.delete('/<user_id>/sessions/<session_id>')
@require_permission('user.session')
def revoke_user_session(user_id: str, session_id: str):
    db = get_auth_session()
    auth_session = db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user_id))
    if auth_session is None:
        return jsonify({'success': False, 'error': '会话不存在'}), 404
    auth_session.revoked_at = datetime.utcnow()
    audit(db, request, action='user.session.revoke', module='user', user=g.current_user, resource_type='session', resource_id=session_id)
    db.commit()
    return jsonify({'success': True})
