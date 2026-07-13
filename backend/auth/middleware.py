from __future__ import annotations

from datetime import datetime, timedelta
from functools import wraps
import os
from typing import Callable, Optional

from flask import Flask, g, jsonify, request
from sqlalchemy import select

from .database import get_auth_session
from .guest_scope import enforce_guest_data_scope
from .models import AuthSession
from .permissions import permission_codes_for_user
from .security import token_digest


SESSION_COOKIE_NAME = 'pos_session'
try:
    IDLE_LOCK_MINUTES = max(1, int(os.getenv('POS_IDLE_LOCK_MINUTES', '30')))
except ValueError:
    IDLE_LOCK_MINUTES = 30

PUBLIC_ENDPOINTS = {
    'health',
    'auth.bootstrap_status',
    'auth.bootstrap',
    'auth.login_password',
    'auth.login_short',
    'auth.demo_credentials',
}
LOCK_ALLOWED_ENDPOINTS = {'auth.me', 'auth.unlock', 'auth.logout'}
PASSWORD_CHANGE_ALLOWED_ENDPOINTS = {'auth.me', 'auth.update_password', 'auth.logout', 'auth.switch_account'}
CSRF_EXEMPT_ENDPOINTS = PUBLIC_ENDPOINTS | {'auth.unlock', 'auth.logout'}


def _error(message: str, status: int, code: str):
    return jsonify({'success': False, 'error': message, 'code': code}), status


def permission_denied(permission_code: Optional[str] = None):
    payload = {'success': False, 'error': '当前账号没有执行此操作的权限', 'code': 'PERMISSION_DENIED'}
    if permission_code:
        payload['permission'] = permission_code
    return jsonify(payload), 403


def has_permission(permission_code: str) -> bool:
    return permission_code in getattr(g, 'current_permissions', set())


def install_auth_middleware(app: Flask) -> None:
    @app.before_request
    def authenticate_request():
        if not request.path.startswith('/api/') or request.endpoint in PUBLIC_ENDPOINTS:
            return None

        raw_token = request.cookies.get(SESSION_COOKIE_NAME, '')
        if not raw_token:
            return _error('请先登录', 401, 'AUTH_REQUIRED')

        db = get_auth_session()
        auth_session = db.scalar(
            select(AuthSession).where(AuthSession.token_hash == token_digest(raw_token))
        )
        now = datetime.utcnow()
        if auth_session is None or auth_session.revoked_at is not None or auth_session.expires_at <= now:
            return _error('登录状态已失效，请重新登录', 401, 'SESSION_EXPIRED')
        if auth_session.user.status == 'disabled':
            auth_session.revoked_at = now
            db.commit()
            return _error('账号已停用', 403, 'USER_DISABLED')

        if auth_session.locked_at is None and now - auth_session.last_activity_at > timedelta(minutes=IDLE_LOCK_MINUTES):
            auth_session.locked_at = now
            db.commit()

        g.current_session = auth_session
        g.current_user = auth_session.user
        g.current_permissions = permission_codes_for_user(auth_session.user)

        if auth_session.locked_at is not None and request.endpoint not in LOCK_ALLOWED_ENDPOINTS:
            return _error('屏幕已锁定，请验证身份后继续', 423, 'SESSION_LOCKED')

        if (
            (auth_session.user.must_change_password or auth_session.user.status == 'password_change_required')
            and request.endpoint not in PASSWORD_CHANGE_ALLOWED_ENDPOINTS
        ):
            return _error('请先修改临时密码', 428, 'PASSWORD_CHANGE_REQUIRED')

        if request.method not in {'GET', 'HEAD', 'OPTIONS'} and request.endpoint not in CSRF_EXEMPT_ENDPOINTS:
            csrf_token = request.headers.get('X-CSRF-Token', '')
            if not csrf_token or csrf_token != auth_session.csrf_token:
                return _error('请求校验失败，请刷新后重试', 403, 'CSRF_INVALID')

        guest_scope_response = enforce_guest_data_scope()
        if guest_scope_response is not None:
            return guest_scope_response

        if request.endpoint not in LOCK_ALLOWED_ENDPOINTS:
            auth_session.last_activity_at = now
            auth_session.user.last_action_at = now
            db.commit()
        return None

    @app.after_request
    def audit_business_request(response):
        endpoint = request.endpoint or ''
        explicitly_audited = endpoint.startswith(('auth.', 'users.', 'roles.', 'audit_logs.'))
        notable_read = any(value in endpoint.lower() for value in ('export', 'print', 'reprint'))
        should_audit = request.method not in {'GET', 'HEAD', 'OPTIONS'} or notable_read
        if (
            request.path.startswith('/api/')
            and should_audit
            and not explicitly_audited
            and getattr(g, 'current_user', None) is not None
        ):
            db = None
            try:
                from .service import audit

                db = get_auth_session()
                resource_id = None
                if request.view_args:
                    resource_id = '/'.join(str(value) for value in request.view_args.values())
                audit(
                    db,
                    request,
                    action=endpoint or f'{request.method} {request.path}',
                    module=endpoint.split('.', 1)[0] if '.' in endpoint else 'business',
                    user=g.current_user,
                    resource_type=endpoint.split('.', 1)[0] if endpoint else 'api',
                    resource_id=resource_id,
                    result='success' if response.status_code < 400 else 'failed',
                    error_code=None if response.status_code < 400 else f'HTTP_{response.status_code}',
                )
                db.commit()
            except Exception:
                # 审计写入失败不能篡改原业务响应；后续由服务日志暴露异常。
                if db is not None:
                    db.rollback()
        return response


def require_permission(permission_code: str):
    def decorator(func: Callable):
        @wraps(func)
        def wrapped(*args, **kwargs):
            if not has_permission(permission_code):
                return permission_denied(permission_code)
            return func(*args, **kwargs)
        return wrapped
    return decorator


def require_any_permission(*permission_codes: str):
    def decorator(func: Callable):
        @wraps(func)
        def wrapped(*args, **kwargs):
            if not any(has_permission(code) for code in permission_codes):
                return permission_denied(' | '.join(permission_codes))
            return func(*args, **kwargs)
        return wrapped
    return decorator
