from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from typing import Optional, Sequence, Tuple

from flask import Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .models import AuditLog, AuthSession, Role, User
from .permissions import permission_codes_for_user, user_to_dict, utc_iso
from .security import (
    create_csrf_token,
    create_session_token,
    hash_secret,
    needs_rehash,
    token_digest,
    validate_password,
    validate_short_account,
    validate_short_password,
    verify_secret,
)


def _positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


SESSION_HOURS = _positive_int_env('POS_SESSION_HOURS', 12)
MAX_ACTIVE_SESSIONS = _positive_int_env('POS_MAX_ACTIVE_SESSIONS', 2)
LOGIN_FAILURE_LIMIT = _positive_int_env('POS_LOGIN_FAILURE_LIMIT', 5)
LOGIN_LOCK_MINUTES = _positive_int_env('POS_LOGIN_LOCK_MINUTES', 15)


def utc_now() -> datetime:
    return datetime.utcnow()


def client_ip(request: Request) -> Optional[str]:
    trust_proxy = os.getenv('POS_TRUST_PROXY', '').strip().lower() in {'1', 'true', 'yes', 'on'}
    if trust_proxy:
        forwarded = request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
        if forwarded:
            return forwarded
    return request.remote_addr


def audit(
    session: Session,
    request: Request,
    action: str,
    module: str = 'auth',
    user: Optional[User] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    reason: Optional[str] = None,
    result: str = 'success',
    error_code: Optional[str] = None,
) -> None:
    session.add(AuditLog(
        user_id=user.id if user else None,
        user_name=user.display_name if user else None,
        role_snapshot=json.dumps([role.code for role in user.roles], ensure_ascii=False) if user else '[]',
        ip_address=client_ip(request),
        user_agent=request.headers.get('User-Agent'),
        module=module,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        before_snapshot=json.dumps(before, ensure_ascii=False) if before is not None else None,
        after_snapshot=json.dumps(after, ensure_ascii=False) if after is not None else None,
        reason=reason,
        result=result,
        error_code=error_code,
    ))


def is_initialized(session: Session) -> bool:
    return bool(session.scalar(select(func.count(User.id))))


def create_initial_admin(session: Session, payload: dict, request: Request) -> User:
    if is_initialized(session):
        raise ValueError('系统已经完成初始化')
    username = str(payload.get('username', '')).strip()
    employee_no = str(payload.get('employee_no', '')).strip()
    short_account = str(payload.get('short_account', employee_no)).strip()
    display_name = str(payload.get('display_name', '')).strip()
    password = str(payload.get('password', ''))
    short_password = str(payload.get('short_password', payload.get('pin', '')))
    if not username or not employee_no or not display_name:
        raise ValueError('管理员姓名、登录账号和员工号均不能为空')
    validate_password(password)
    validate_short_account(short_account)
    validate_short_password(short_password)
    role = session.scalar(select(Role).where(Role.code == 'superadmin'))
    if role is None:
        raise RuntimeError('超级管理员角色尚未初始化')
    user = User(
        username=username,
        employee_no=employee_no,
        short_account=short_account,
        display_name=display_name,
        phone=str(payload.get('phone', '')).strip() or None,
        password_hash=hash_secret(password),
        pin_hash=hash_secret(short_password),
        status='active',
        must_change_password=False,
        roles=[role],
    )
    session.add(user)
    session.flush()
    audit(
        session,
        request,
        action='auth.bootstrap',
        user=user,
        resource_type='user',
        resource_id=user.id,
        after={'username': username, 'employee_no': employee_no, 'roles': ['superadmin']},
    )
    return user


def _find_user(session: Session, identifier: str, login_method: str) -> Optional[User]:
    if login_method == 'short':
        return session.scalar(select(User).where(User.short_account == identifier))
    return session.scalar(
        select(User).where(or_(User.username == identifier, User.employee_no == identifier))
    )


def authenticate_user(
    session: Session,
    request: Request,
    identifier: str,
    secret: str,
    login_method: str,
) -> Tuple[Optional[User], Optional[str]]:
    now = utc_now()
    user = _find_user(session, identifier.strip(), login_method)
    if user is None:
        audit(session, request, action='auth.login', result='failed', error_code='INVALID_CREDENTIALS')
        return None, '账号或凭证错误'
    if user.status == 'disabled':
        audit(session, request, action='auth.login', user=user, result='failed', error_code='USER_DISABLED')
        return None, '账号或凭证错误'
    if user.locked_until and user.locked_until > now:
        audit(session, request, action='auth.login', user=user, result='failed', error_code='ACCOUNT_LOCKED')
        return None, '账号暂时锁定，请稍后再试'
    if user.locked_until and user.locked_until <= now:
        user.locked_until = None
        user.failed_login_count = 0

    stored_hash = user.pin_hash if login_method == 'short' else user.password_hash
    if not stored_hash or not verify_secret(stored_hash, secret):
        user.failed_login_count += 1
        error_code = 'INVALID_CREDENTIALS'
        error_message = '账号或凭证错误'
        if user.failed_login_count >= LOGIN_FAILURE_LIMIT:
            user.locked_until = now + timedelta(minutes=LOGIN_LOCK_MINUTES)
            error_code = 'ACCOUNT_LOCKED'
            error_message = f'连续失败次数过多，账号已锁定 {LOGIN_LOCK_MINUTES} 分钟'
        audit(session, request, action='auth.login', user=user, result='failed', error_code=error_code)
        return None, error_message

    if needs_rehash(stored_hash):
        if login_method == 'short':
            user.pin_hash = hash_secret(secret)
        else:
            user.password_hash = hash_secret(secret)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    user.last_action_at = now
    audit(session, request, action='auth.login', user=user)
    return user, None


def create_user_session(session: Session, user: User, request: Request, login_method: str) -> Tuple[AuthSession, str]:
    now = utc_now()
    active_sessions = list(session.scalars(
        select(AuthSession)
        .where(
            AuthSession.user_id == user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
        )
        .order_by(AuthSession.last_activity_at.asc())
    ).all())
    while len(active_sessions) >= MAX_ACTIVE_SESSIONS:
        active_sessions.pop(0).revoked_at = now

    raw_token = create_session_token()
    auth_session = AuthSession(
        token_hash=token_digest(raw_token),
        csrf_token=create_csrf_token(),
        user=user,
        login_method=login_method,
        role_snapshot=json.dumps([role.code for role in user.roles], ensure_ascii=False),
        ip_address=client_ip(request),
        user_agent=request.headers.get('User-Agent'),
        expires_at=now + timedelta(hours=SESSION_HOURS),
    )
    session.add(auth_session)
    session.flush()
    return auth_session, raw_token


def auth_payload(user: User, auth_session: AuthSession) -> dict:
    permissions = permission_codes_for_user(user)
    settings_permissions = {
        'menu.view', 'table_config.view', 'voucher.view', 'system.production_ticket',
        'user.view', 'role.view', 'audit.view',
    }
    allowed_defaults = {
        'tables': 'table.view' in permissions,
        'history': 'history.view' in permissions,
        'production-history': 'ticket.history' in permissions,
        'settings': bool(settings_permissions & permissions),
    }
    role_default = next((
        role.default_view for role in user.roles
        if role.default_view and allowed_defaults.get(role.default_view, False)
    ), None)
    if role_default is None:
        role_default = next((view for view in ('tables', 'history', 'production-history', 'settings') if allowed_defaults[view]), 'tables')
    return {
        'user': user_to_dict(user),
        'csrf_token': auth_session.csrf_token,
        'session': {
            'id': auth_session.id,
            'login_method': auth_session.login_method,
            'locked': auth_session.locked_at is not None,
            'created_at': utc_iso(auth_session.created_at),
            'expires_at': utc_iso(auth_session.expires_at),
        },
        'default_view': role_default,
    }


def role_objects(session: Session, role_codes: Sequence[str]) -> list:
    unique_codes = sorted(set(str(code) for code in role_codes if code))
    if not unique_codes:
        raise ValueError('至少需要分配一个角色')
    roles = list(session.scalars(select(Role).where(Role.code.in_(unique_codes))).all())
    if len(roles) != len(unique_codes):
        raise ValueError('包含不存在的角色')
    return roles


def active_superadmin_count(session: Session, excluding_user_id: Optional[str] = None) -> int:
    users = list(session.scalars(select(User).where(User.status != 'disabled')).all())
    return sum(
        1 for user in users
        if user.id != excluding_user_id and any(role.code == 'superadmin' for role in user.roles)
    )
