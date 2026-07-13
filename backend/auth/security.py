from __future__ import annotations

import hashlib
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError


password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)


def validate_password(password: str) -> None:
    if len(password) < 8:
        raise ValueError('密码至少需要 8 位')
    if not re.search(r'[A-Za-z]', password) or not re.search(r'\d', password):
        raise ValueError('密码必须同时包含字母和数字')


def validate_pin(pin: str) -> None:
    validate_short_password(pin)


def validate_short_account(account: str) -> None:
    if not re.fullmatch(r'[A-Za-z0-9]{2,12}', account):
        raise ValueError('短账号需为 2 至 12 位字母或数字')


def validate_short_password(password: str) -> None:
    if not re.fullmatch(r'\d{4,8}', password):
        raise ValueError('短密码需为 4 至 8 位数字')
    if len(set(password)) == 1 or password in '0123456789' or password in '9876543210':
        raise ValueError('短密码不能使用连续或完全重复的数字')


def hash_secret(value: str) -> str:
    return password_hasher.hash(value)


def verify_secret(stored_hash: str, value: str) -> bool:
    try:
        return password_hasher.verify(stored_hash, value)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return password_hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


def create_session_token() -> str:
    return secrets.token_urlsafe(48)


def create_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()
