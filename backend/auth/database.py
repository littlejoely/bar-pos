from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, g
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE_PATH = BACKEND_DIR / 'instance' / 'auth.db'


def _database_url() -> str:
    configured = os.getenv('POS_AUTH_DATABASE_URL', '').strip()
    if configured:
        return configured
    database_path = Path(os.getenv('POS_AUTH_DATABASE_PATH', str(DEFAULT_DATABASE_PATH)))
    database_path.parent.mkdir(parents=True, exist_ok=True)
    return f'sqlite:///{database_path}'


DATABASE_URL = _database_url()

engine = create_engine(
    DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args={'check_same_thread': False} if DATABASE_URL.startswith('sqlite:') else {},
)


if DATABASE_URL.startswith('sqlite:'):
    @event.listens_for(engine, 'connect')
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_auth_session() -> Session:
    session = getattr(g, '_auth_db_session', None)
    if session is None:
        session = SessionLocal()
        g._auth_db_session = session
    return session


def remove_auth_session(_error=None) -> None:
    session = getattr(g, '_auth_db_session', None)
    if session is not None:
        session.close()
        g._auth_db_session = None


def init_auth_database(app: Flask) -> None:
    from . import models  # noqa: F401
    from .permissions import ensure_demo_guest, seed_roles_and_permissions

    Base.metadata.create_all(bind=engine)
    _ensure_schema_compatibility()
    with SessionLocal() as session:
        seed_roles_and_permissions(session)
        ensure_demo_guest(session)
        session.commit()
    app.teardown_appcontext(remove_auth_session)


def _ensure_schema_compatibility() -> None:
    """为 create_all 无法覆盖的既有 SQLite 表补充兼容字段。"""
    with engine.begin() as connection:
        inspector = inspect(connection)
        if 'users' not in inspector.get_table_names():
            return
        columns = {column['name'] for column in inspector.get_columns('users')}
        if 'short_account' not in columns:
            connection.execute(text('ALTER TABLE users ADD COLUMN short_account VARCHAR(32)'))
        if 'must_change_password' not in columns:
            connection.execute(text('ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0'))
            connection.execute(text(
                "UPDATE users SET must_change_password = 1, status = 'active' "
                "WHERE status = 'password_change_required'"
            ))
        if 'data_scope' not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN data_scope VARCHAR(32) NOT NULL DEFAULT 'all'"))
            connection.execute(text('CREATE INDEX IF NOT EXISTS ix_users_data_scope ON users (data_scope)'))
        if 'created_by_user_id' not in columns:
            connection.execute(text('ALTER TABLE users ADD COLUMN created_by_user_id VARCHAR(36)'))
            connection.execute(text('CREATE INDEX IF NOT EXISTS ix_users_created_by_user_id ON users (created_by_user_id)'))
        connection.execute(text(
            "UPDATE users SET short_account = employee_no "
            "WHERE short_account IS NULL OR short_account = ''"
        ))
        connection.execute(text(
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_users_short_account ON users (short_account)'
        ))
        if 'auth_sessions' in inspector.get_table_names():
            connection.execute(text("UPDATE auth_sessions SET login_method = 'short' WHERE login_method = 'pin'"))
        if 'roles' in inspector.get_table_names():
            role_columns = {column['name'] for column in inspector.get_columns('roles')}
            if 'created_by_user_id' not in role_columns:
                connection.execute(text('ALTER TABLE roles ADD COLUMN created_by_user_id VARCHAR(36)'))
                connection.execute(text('CREATE INDEX IF NOT EXISTS ix_roles_created_by_user_id ON roles (created_by_user_id)'))
