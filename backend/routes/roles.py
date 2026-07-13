from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from auth.database import get_auth_session
from auth.middleware import require_permission
from auth.models import Permission, Role
from auth.permissions import permission_catalog, role_to_dict
from auth.service import audit


roles_bp = Blueprint('roles', __name__)
ALLOWED_DEFAULT_VIEWS = {'tables', 'history', 'production-history', 'settings'}


def _current_is_superadmin() -> bool:
    return any(role.code == 'superadmin' for role in g.current_user.roles)


@roles_bp.get('')
@require_permission('role.view')
def list_roles():
    db = get_auth_session()
    roles = list(db.scalars(select(Role).order_by(Role.is_system.desc(), Role.id.asc())).all())
    if not _current_is_superadmin():
        roles = [role for role in roles if role.code != 'superadmin']
    return jsonify({'success': True, 'data': [role_to_dict(role) for role in roles]})


@roles_bp.get('/permissions')
@require_permission('role.view')
def list_permissions():
    return jsonify({'success': True, 'data': permission_catalog()})


def _permission_objects(codes):
    db = get_auth_session()
    unique_codes = sorted(set(str(code) for code in codes or []))
    permissions = list(db.scalars(select(Permission).where(Permission.code.in_(unique_codes))).all()) if unique_codes else []
    if len(permissions) != len(unique_codes):
        raise ValueError('包含不存在的权限')
    return permissions


@roles_bp.post('')
@require_permission('role.create')
def create_role():
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    code = str(payload.get('code', '')).strip().lower()
    name = str(payload.get('name', '')).strip()
    if not code or not name or not code.replace('_', '').isalnum():
        return jsonify({'success': False, 'error': '角色名称和有效的角色代码不能为空'}), 400
    if db.scalar(select(Role).where(Role.code == code)):
        return jsonify({'success': False, 'error': '角色代码已存在'}), 409
    default_view = str(payload.get('default_view', 'tables'))
    if default_view not in ALLOWED_DEFAULT_VIEWS:
        return jsonify({'success': False, 'error': '默认首页无效'}), 400
    try:
        permissions = _permission_objects(payload.get('permissions'))
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    role = Role(
        code=code,
        name=name,
        description=str(payload.get('description', '')).strip(),
        default_view=default_view,
        is_system=False,
        created_by_user_id=g.current_user.id,
        permissions=permissions,
    )
    db.add(role)
    db.flush()
    audit(db, request, action='role.create', module='role', user=g.current_user, resource_type='role', resource_id=str(role.id), after=role_to_dict(role))
    db.commit()
    return jsonify({'success': True, 'data': role_to_dict(role)}), 201


@roles_bp.patch('/<int:role_id>')
@require_permission('role.edit')
def update_role(role_id: int):
    db = get_auth_session()
    role = db.get(Role, role_id)
    if role is None:
        return jsonify({'success': False, 'error': '角色不存在'}), 404
    if role.code == 'superadmin':
        if not _current_is_superadmin():
            return jsonify({'success': False, 'error': '角色不存在'}), 404
        return jsonify({'success': False, 'error': '超级管理员角色必须保留全部权限，不能修改'}), 400
    payload = request.get_json(silent=True) or {}
    before = role_to_dict(role)
    next_code = str(payload.get('code', role.code)).strip().lower()
    next_name = str(payload.get('name', role.name)).strip()
    if not next_code or not next_name or not next_code.replace('_', '').isalnum():
        return jsonify({'success': False, 'error': '角色名称和有效的角色代码不能为空'}), 400
    conflict = db.scalar(select(Role).where(Role.code == next_code, Role.id != role.id))
    if conflict:
        return jsonify({'success': False, 'error': '角色代码已存在'}), 409
    next_default_view = str(payload.get('default_view', role.default_view))
    if next_default_view not in ALLOWED_DEFAULT_VIEWS:
        return jsonify({'success': False, 'error': '默认首页无效'}), 400
    role.code = next_code
    role.name = next_name
    role.description = str(payload.get('description', role.description)).strip()
    role.default_view = next_default_view
    # 除超级管理员外，所有角色均按普通角色处理。
    role.is_system = False
    if 'permissions' in payload:
        try:
            role.permissions = _permission_objects(payload['permissions'])
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400
    audit(db, request, action='role.edit', module='role', user=g.current_user, resource_type='role', resource_id=str(role.id), before=before, after=role_to_dict(role))
    db.commit()
    return jsonify({'success': True, 'data': role_to_dict(role)})


@roles_bp.delete('/<int:role_id>')
@require_permission('role.delete')
def delete_role(role_id: int):
    db = get_auth_session()
    role = db.get(Role, role_id)
    if role is None:
        return jsonify({'success': False, 'error': '角色不存在'}), 404
    if role.code == 'superadmin':
        if not _current_is_superadmin():
            return jsonify({'success': False, 'error': '角色不存在'}), 404
        return jsonify({'success': False, 'error': '超级管理员角色不能删除'}), 400
    before = role_to_dict(role)
    assigned_users = list(role.users)
    replacement_role = None
    if assigned_users:
        payload = request.get_json(silent=True) or {}
        replacement_role_id = payload.get('replacement_role_id')
        if replacement_role_id is None:
            return jsonify({
                'success': False,
                'error': f'当前仍有 {len(assigned_users)} 名用户使用此角色，请选择接替角色',
                'code': 'ROLE_REPLACEMENT_REQUIRED',
                'user_count': len(assigned_users),
            }), 409
        if 'role.assign' not in g.current_permissions:
            return jsonify({'success': False, 'error': '没有改派用户角色的权限', 'code': 'PERMISSION_DENIED'}), 403
        try:
            replacement_role = db.get(Role, int(replacement_role_id))
        except (TypeError, ValueError):
            replacement_role = None
        if replacement_role is None or replacement_role.id == role.id:
            return jsonify({'success': False, 'error': '接替角色无效'}), 400
        if replacement_role.code == 'superadmin':
            return jsonify({'success': False, 'error': '不能在删除角色时批量改派为超级管理员'}), 400
        for user in assigned_users:
            next_roles = [item for item in user.roles if item.id != role.id]
            if all(item.id != replacement_role.id for item in next_roles):
                next_roles.append(replacement_role)
            user.roles = next_roles
        db.flush()
    audit(
        db,
        request,
        action='role.delete',
        module='role',
        user=g.current_user,
        resource_type='role',
        resource_id=str(role.id),
        before=before,
        after={
            'reassigned_user_count': len(assigned_users),
            'replacement_role': role_to_dict(replacement_role, False) if replacement_role else None,
        },
    )
    db.delete(role)
    db.commit()
    return jsonify({'success': True, 'reassigned_user_count': len(assigned_users)})
