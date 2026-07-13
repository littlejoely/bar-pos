"""Authentication, server-side sessions, and RBAC foundation."""

from .database import init_auth_database, remove_auth_session
from .middleware import install_auth_middleware

__all__ = ['init_auth_database', 'install_auth_middleware', 'remove_auth_session']
