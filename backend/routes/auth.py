from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime

from flask import Blueprint, g, jsonify, make_response, request

from auth.database import get_auth_session
from auth.middleware import SESSION_COOKIE_NAME
from auth.permissions import demo_guest_config, ensure_demo_guest
from auth.security import hash_secret, validate_password, validate_short_password, verify_secret
from auth.service import (
    audit,
    auth_payload,
    authenticate_user,
    create_initial_admin,
    create_user_session,
    client_ip,
    is_initialized,
    SESSION_HOURS,
)


auth_bp = Blueprint('auth', __name__)
_rate_lock = threading.Lock()
_rate_events = defaultdict(deque)


def _positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _rate_limited(scope: str, identity: str, limit: int, window_seconds: int) -> bool:
    now = time.monotonic()
    key = f'{scope}:{identity}'
    with _rate_lock:
        events = _rate_events[key]
        while events and now - events[0] >= window_seconds:
            events.popleft()
        if len(events) >= limit:
            return True
        events.append(now)
        return False


def _rate_limit_response():
    return jsonify({'success': False, 'error': '尝试次数过多，请稍后再试', 'code': 'RATE_LIMITED'}), 429


def _cookie_secure() -> bool:
    return os.getenv('POS_COOKIE_SECURE', '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _with_session_cookie(payload: dict, raw_token: str, status: int = 200):
    response = make_response(jsonify({'success': True, 'data': payload}), status)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        raw_token,
        max_age=SESSION_HOURS * 60 * 60,
        httponly=True,
        secure=_cookie_secure(),
        samesite='Lax',
        path='/',
    )
    return response


def _clear_session_cookie(response):
    response.delete_cookie(SESSION_COOKIE_NAME, path='/', samesite='Lax')
    return response


@auth_bp.get('/bootstrap-status')
def bootstrap_status():
    db = get_auth_session()
    return jsonify({'success': True, 'data': {'initialized': is_initialized(db)}})


@auth_bp.get('/demo-credentials')
def demo_credentials():
    config = demo_guest_config()
    if not config['enabled']:
        return jsonify({'success': True, 'data': None})
    return jsonify({'success': True, 'data': {
        'username': config['username'],
        'password': config['password'],
    }})


@auth_bp.post('/bootstrap')
def bootstrap():
    db = get_auth_session()
    try:
        user = create_initial_admin(db, request.get_json(silent=True) or {}, request)
        ensure_demo_guest(db)
        auth_session, raw_token = create_user_session(db, user, request, 'password')
        db.commit()
        return _with_session_cookie(auth_payload(user, auth_session), raw_token, 201)
    except ValueError as exc:
        db.rollback()
        return jsonify({'success': False, 'error': str(exc), 'code': 'BOOTSTRAP_INVALID'}), 400
    except Exception:
        db.rollback()
        return jsonify({'success': False, 'error': '初始化失败，请检查填写内容', 'code': 'BOOTSTRAP_FAILED'}), 500


def _login(login_method: str):
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    identifier = str(payload.get('identifier', '')).strip()
    secret_field = 'short_password' if login_method == 'short' else 'password'
    secret = str(payload.get(secret_field, ''))
    if not identifier or not secret:
        return jsonify({'success': False, 'error': '请输入账号和凭证', 'code': 'LOGIN_INVALID'}), 400
    rate_identity = f'{client_ip(request) or "unknown"}:{identifier.lower()}'
    if _rate_limited('login', rate_identity, _positive_int_env('POS_LOGIN_RATE_LIMIT', 10), 60):
        return _rate_limit_response()
    user, error = authenticate_user(db, request, identifier, secret, login_method)
    if user is None:
        db.commit()
        return jsonify({'success': False, 'error': error, 'code': 'LOGIN_FAILED'}), 401
    auth_session, raw_token = create_user_session(db, user, request, login_method)
    db.commit()
    return _with_session_cookie(auth_payload(user, auth_session), raw_token)


@auth_bp.post('/login/password')
def login_password():
    return _login('password')


@auth_bp.post('/login/short')
def login_short():
    return _login('short')


@auth_bp.post('/switch')
def switch_account():
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    login_method = str(payload.get('method', 'short'))
    if login_method not in {'password', 'short'}:
        return jsonify({'success': False, 'error': '不支持的验证方式', 'code': 'LOGIN_METHOD_INVALID'}), 400
    identifier = str(payload.get('identifier', '')).strip()
    secret_field = 'short_password' if login_method == 'short' else 'password'
    secret = str(payload.get(secret_field, ''))
    if not identifier or not secret:
        return jsonify({'success': False, 'error': '请输入目标账号和凭证', 'code': 'SWITCH_INVALID'}), 400
    rate_identity = f'{client_ip(request) or "unknown"}:{identifier.lower()}'
    if _rate_limited('switch', rate_identity, _positive_int_env('POS_LOGIN_RATE_LIMIT', 10), 60):
        return _rate_limit_response()

    next_user, error = authenticate_user(db, request, identifier, secret, login_method)
    if next_user is None:
        db.commit()
        return jsonify({'success': False, 'error': error, 'code': 'SWITCH_FAILED'}), 400

    previous_user = g.current_user
    g.current_session.revoked_at = datetime.utcnow()
    next_session, raw_token = create_user_session(db, next_user, request, login_method)
    audit(
        db,
        request,
        action='auth.switch',
        user=next_user,
        resource_type='user',
        resource_id=next_user.id,
        before={'user_id': previous_user.id, 'display_name': previous_user.display_name},
        after={'user_id': next_user.id, 'display_name': next_user.display_name},
    )
    db.commit()
    return _with_session_cookie(auth_payload(next_user, next_session), raw_token)


@auth_bp.get('/me')
def me():
    return jsonify({'success': True, 'data': auth_payload(g.current_user, g.current_session)})


@auth_bp.post('/logout')
def logout():
    db = get_auth_session()
    g.current_session.revoked_at = datetime.utcnow()
    audit(db, request, action='auth.logout', user=g.current_user)
    db.commit()
    return _clear_session_cookie(make_response(jsonify({'success': True})))


@auth_bp.post('/lock')
def lock():
    db = get_auth_session()
    if g.current_session.locked_at is None:
        g.current_session.locked_at = datetime.utcnow()
        audit(db, request, action='auth.lock', user=g.current_user)
        db.commit()
    return jsonify({'success': True})


@auth_bp.post('/unlock')
def unlock():
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    method = str(payload.get('method', g.current_session.login_method))
    if method not in {'password', 'short'}:
        return jsonify({'success': False, 'error': '不支持的验证方式', 'code': 'LOGIN_METHOD_INVALID'}), 400
    secret_field = 'short_password' if method == 'short' else 'password'
    secret = str(payload.get(secret_field, ''))
    stored = g.current_user.pin_hash if method == 'short' else g.current_user.password_hash
    if _rate_limited('unlock', g.current_session.id, _positive_int_env('POS_UNLOCK_RATE_LIMIT', 5), 300):
        return _rate_limit_response()
    if not stored or not verify_secret(stored, secret):
        audit(db, request, action='auth.unlock', user=g.current_user, result='failed', error_code='INVALID_CREDENTIALS')
        db.commit()
        return jsonify({'success': False, 'error': '凭证错误', 'code': 'UNLOCK_FAILED'}), 401
    g.current_session.locked_at = None
    g.current_session.last_activity_at = datetime.utcnow()
    audit(db, request, action='auth.unlock', user=g.current_user)
    db.commit()
    return jsonify({'success': True, 'data': auth_payload(g.current_user, g.current_session)})


@auth_bp.put('/password')
def update_password():
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    current_password = str(payload.get('current_password', ''))
    new_password = str(payload.get('new_password', ''))
    if not verify_secret(g.current_user.password_hash, current_password):
        return jsonify({'success': False, 'error': '当前密码错误', 'code': 'INVALID_CREDENTIALS'}), 400
    try:
        validate_password(new_password)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc), 'code': 'PASSWORD_INVALID'}), 400
    if verify_secret(g.current_user.password_hash, new_password):
        return jsonify({'success': False, 'error': '新密码不能与当前密码相同', 'code': 'PASSWORD_REUSED'}), 400
    g.current_user.password_hash = hash_secret(new_password)
    g.current_user.must_change_password = False
    if g.current_user.status == 'password_change_required':
        g.current_user.status = 'active'
    now = datetime.utcnow()
    for auth_session in g.current_user.sessions:
        if auth_session.id != g.current_session.id and auth_session.revoked_at is None:
            auth_session.revoked_at = now
    audit(db, request, action='auth.password.change', user=g.current_user)
    db.commit()
    return jsonify({'success': True})


@auth_bp.put('/short-password')
def update_short_password():
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    current_password = str(payload.get('current_password', ''))
    new_short_password = str(payload.get('new_short_password', payload.get('new_pin', '')))
    if not verify_secret(g.current_user.password_hash, current_password):
        return jsonify({'success': False, 'error': '当前密码错误', 'code': 'INVALID_CREDENTIALS'}), 400
    try:
        validate_short_password(new_short_password)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc), 'code': 'SHORT_PASSWORD_INVALID'}), 400
    if g.current_user.pin_hash and verify_secret(g.current_user.pin_hash, new_short_password):
        return jsonify({'success': False, 'error': '新短密码不能与当前短密码相同', 'code': 'SHORT_PASSWORD_REUSED'}), 400
    g.current_user.pin_hash = hash_secret(new_short_password)
    now = datetime.utcnow()
    for auth_session in g.current_user.sessions:
        if auth_session.id != g.current_session.id and auth_session.revoked_at is None:
            auth_session.revoked_at = now
    audit(db, request, action='auth.short_password.change', user=g.current_user)
    db.commit()
    return jsonify({'success': True})
