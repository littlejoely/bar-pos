from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Table, Text, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.utcnow()


user_roles = Table(
    'user_roles',
    Base.metadata,
    Column('user_id', String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('role_id', Integer, ForeignKey('roles.id', ondelete='CASCADE'), primary_key=True),
)

role_permissions = Table(
    'role_permissions',
    Base.metadata,
    Column('role_id', Integer, ForeignKey('roles.id', ondelete='CASCADE'), primary_key=True),
    Column('permission_id', Integer, ForeignKey('permissions.id', ondelete='CASCADE'), primary_key=True),
)


class User(Base):
    __tablename__ = 'users'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    employee_no: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    short_account: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(64))
    phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    password_hash: Mapped[str] = mapped_column(Text)
    # 兼容既有数据库列名；业务含义已由员工 PIN 升级为“短密码”。
    pin_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default='password_change_required', index=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    data_scope: Mapped[str] = mapped_column(String(32), default='all', index=True)
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_action_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    roles: Mapped[list['Role']] = relationship(secondary=user_roles, back_populates='users', lazy='selectin')
    sessions: Mapped[list['AuthSession']] = relationship(back_populates='user', cascade='all, delete-orphan')


class Role(Base):
    __tablename__ = 'roles'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default='')
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    default_view: Mapped[str] = mapped_column(String(64), default='tables')
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    users: Mapped[list[User]] = relationship(secondary=user_roles, back_populates='roles')
    permissions: Mapped[list['Permission']] = relationship(
        secondary=role_permissions,
        back_populates='roles',
        lazy='selectin',
    )


class Permission(Base):
    __tablename__ = 'permissions'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(96), unique=True, index=True)
    module: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(96))
    description: Mapped[str] = mapped_column(Text, default='')

    roles: Mapped[list[Role]] = relationship(secondary=role_permissions, back_populates='permissions')


class AuthSession(Base):
    __tablename__ = 'auth_sessions'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(96))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey('users.id', ondelete='CASCADE'), index=True)
    login_method: Mapped[str] = mapped_column(String(16))
    role_snapshot: Mapped[str] = mapped_column(Text, default='[]')
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates='sessions', lazy='joined')


class AuditLog(Base):
    __tablename__ = 'audit_logs'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    user_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    role_snapshot: Mapped[str] = mapped_column(Text, default='[]')
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    module: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(96), index=True)
    resource_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    before_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approver_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    result: Mapped[str] = mapped_column(String(32), default='success')
    error_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class OperationApproval(Base):
    __tablename__ = 'operation_approvals'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    requester_user_id: Mapped[str] = mapped_column(String(36), index=True)
    approver_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    permission_code: Mapped[str] = mapped_column(String(96), index=True)
    resource_type: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str] = mapped_column(String(128))
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default='pending')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
