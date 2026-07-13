from __future__ import annotations

import os
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Permission, Role, User
from .security import hash_secret, verify_secret


PermissionDefinition = Tuple[str, str, str, str]


def utc_iso(value) -> Optional[str]:
    return f'{value.isoformat()}Z' if value else None

PERMISSION_DEFINITIONS: Sequence[PermissionDefinition] = (
    ('table.view', '桌台', '查看', '查看桌台和桌台状态'),
    ('table.open', '桌台', '开台', '开台并设置人数'),
    ('table.edit_guests', '桌台', '修改人数', '修改用餐人数'),
    ('table.transfer', '桌台', '转台', '将订单转移至其他桌台'),
    ('table.merge', '桌台', '并台', '合并桌台订单'),
    ('table.clear', '桌台', '清台', '清理已结清桌台'),
    ('order.create', '点单', '创建订单', '创建新订单'),
    ('order.add_item', '点单', '添加菜品', '向订单添加菜品'),
    ('order.change_quantity', '点单', '修改数量', '修改未提交菜品数量'),
    ('order.addition', '点单', '加菜', '向已下单订单加菜'),
    ('order.submit', '点单', '下单', '提交本轮菜品'),
    ('order.cancel', '点单', '撤单', '撤销订单或撤台'),
    ('order.return', '订单优惠', '退菜', '对已下单菜品执行退菜'),
    ('order.gift', '订单优惠', '赠菜', '将菜品设为赠送'),
    ('order.discount', '订单优惠', '折扣', '设置菜品或整单折扣'),
    ('order.reduction', '订单优惠', '减免', '设置菜品或整单减免'),
    ('order.free', '订单优惠', '免单', '将整单设为免单'),
    ('order.round_down', '订单优惠', '抹零', '设置订单抹零'),
    ('payment.collect', '收款', '收款', '执行扫码或现金收款'),
    ('payment.revoke', '收款', '撤销收款', '撤销一笔收款'),
    ('payment.checkout', '收款', '结账', '完成订单结账'),
    ('payment.refund', '收款', '退款', '对历史订单发起退款'),
    ('ticket.view', '制作单', '查看', '查看当前制作单'),
    ('ticket.check', '制作单', '划菜', '标记菜品已制作'),
    ('ticket.complete', '制作单', '完成', '完成制作单'),
    ('ticket.reprint', '制作单', '补打', '补打制作单'),
    ('ticket.history', '制作单', '历史', '查看制作单历史'),
    ('history.view', '订单历史', '查看', '查看订单历史列表'),
    ('history.detail', '订单历史', '详情', '查看订单详情'),
    ('history.print', '订单历史', '打印', '打印订单详情'),
    ('history.export', '订单历史', '导出', '导出订单数据'),
    ('menu.view', '商品', '查看', '查看商品和类别'),
    ('menu.create', '商品', '新增', '创建商品和类别'),
    ('menu.edit', '商品', '编辑', '编辑商品、类别及排序'),
    ('menu.delete', '商品', '删除', '删除商品和类别'),
    ('menu.batch', '商品', '批量操作', '批量修改商品'),
    ('menu.export', '商品', '导出', '导出商品数据'),
    ('table_config.view', '桌台设置', '查看', '查看区域和桌台配置'),
    ('table_config.edit', '桌台设置', '编辑', '编辑区域和桌台配置'),
    ('voucher.view', '优惠券', '查看', '查看优惠券配置'),
    ('voucher.create', '优惠券', '新增', '创建优惠券'),
    ('voucher.edit', '优惠券', '编辑', '编辑优惠券'),
    ('voucher.delete', '优惠券', '删除', '删除优惠券'),
    ('system.production_ticket', '系统设置', '制作单设置', '开启或关闭制作单模式'),
    ('user.view', '用户权限', '查看用户', '查看用户列表和详情'),
    ('user.create', '用户权限', '创建用户', '创建系统用户'),
    ('user.edit', '用户权限', '编辑用户', '编辑用户资料和状态'),
    ('user.delete', '用户权限', '删除用户', '删除非超级管理员且非当前登录账号的用户'),
    ('user.disable', '用户权限', '停用用户', '停用或启用用户'),
    ('user.reset_credential', '用户权限', '重置凭证', '重置登录密码或短密码'),
    ('user.session', '用户权限', '会话管理', '查看并下线用户会话'),
    ('role.view', '用户权限', '查看角色', '查看角色及权限'),
    ('role.create', '用户权限', '创建角色', '创建角色'),
    ('role.edit', '用户权限', '编辑角色', '编辑角色权限'),
    ('role.delete', '用户权限', '删除角色', '删除非超级管理员角色；使用中的角色需先改派用户'),
    ('role.assign', '用户权限', '分配角色', '为用户分配角色'),
    ('audit.view', '审计日志', '查看', '查看操作审计日志'),
    ('audit.export', '审计日志', '导出', '导出操作审计日志'),
)

ALL_PERMISSION_CODES = {definition[0] for definition in PERMISSION_DEFINITIONS}

# 访客可以浏览全系统，并完整体验自己开台后生成的业务链路；系统配置、
# 用户和角色数据保持只读。真正的数据归属限制由服务端 guest_scope 强制执行。
GUEST_PERMISSION_CODES = ALL_PERMISSION_CODES

ROLE_DEFINITIONS: Dict[str, Dict[str, object]] = {
    'superadmin': {
        'name': '超级管理员',
        'description': '拥有系统全部权限；系统必须始终保留至少一名超级管理员。',
        'default_view': 'tables',
        'permissions': ALL_PERMISSION_CODES,
    },
    'manager': {
        'name': '店长',
        'description': '负责门店经营、配置、历史数据和日常人员管理。',
        'default_view': 'tables',
        'permissions': ALL_PERMISSION_CODES - {'role.create', 'role.edit', 'role.delete', 'role.assign'},
    },
    'cashier': {
        'name': '收银员',
        'description': '负责桌台、点单、收款、订单查询及制作单协作。',
        'default_view': 'tables',
        'permissions': {
            'table.view', 'table.open', 'table.edit_guests', 'table.transfer', 'table.merge', 'table.clear',
            'order.create', 'order.add_item', 'order.change_quantity', 'order.addition', 'order.submit', 'order.cancel',
            'payment.collect', 'payment.revoke', 'payment.checkout',
            'ticket.view', 'ticket.check', 'ticket.complete', 'ticket.reprint', 'ticket.history',
            'history.view', 'history.detail', 'history.print',
            'menu.view', 'voucher.view',
        },
    },
    'waiter': {
        'name': '服务员',
        'description': '负责开台、点单、加菜和查看制作进度。',
        'default_view': 'tables',
        'permissions': {
            'table.view', 'table.open', 'table.edit_guests',
            'order.create', 'order.add_item', 'order.change_quantity', 'order.addition', 'order.submit',
            'ticket.view', 'ticket.check', 'menu.view',
        },
    },
    'producer': {
        'name': '制作人员',
        'description': '负责查看、划菜和完成制作单。',
        'default_view': 'production-history',
        'permissions': {'ticket.view', 'ticket.check', 'ticket.complete', 'ticket.reprint', 'ticket.history'},
    },
}


def seed_roles_and_permissions(session: Session) -> None:
    existing = {item.code: item for item in session.scalars(select(Permission)).all()}
    for code, module, action, description in PERMISSION_DEFINITIONS:
        permission = existing.get(code)
        if permission is None:
            permission = Permission(code=code, module=module, action=action, name=f'{module} · {action}')
            session.add(permission)
            existing[code] = permission
        permission.module = module
        permission.action = action
        permission.name = f'{module} · {action}'
        permission.description = description
    session.flush()

    roles = {item.code: item for item in session.scalars(select(Role)).all()}
    has_existing_roles = bool(roles)
    for code, definition in ROLE_DEFINITIONS.items():
        role = roles.get(code)
        is_new_role = role is None
        if role is None:
            # 已完成初始化后，不自动复活被管理员主动删除的预设角色。
            if has_existing_roles:
                continue
            role = Role(code=code)
            session.add(role)
            roles[code] = role
        if code == 'superadmin' or is_new_role:
            role.name = str(definition['name'])
            role.description = str(definition['description'])
            role.default_view = str(definition['default_view'])
        # 只有超级管理员属于受保护的系统角色；其余默认角色创建后与普通角色完全一致。
        role.is_system = code == 'superadmin'
        # 超级管理员始终保持全部权限；其他预设角色只在首次创建时写入默认权限，
        # 避免管理员的后续配置在服务重启时被种子数据覆盖。
        if code == 'superadmin' or is_new_role:
            role.permissions = [existing[value] for value in sorted(definition['permissions'])]


def demo_guest_config() -> dict:
    enabled = os.getenv('POS_DEMO_GUEST_ENABLED', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
    return {
        'enabled': enabled,
        'username': os.getenv('POS_DEMO_GUEST_USERNAME', 'visitor').strip() or 'visitor',
        'password': os.getenv('POS_DEMO_GUEST_PASSWORD', 'Visitor@2026'),
        'short_account': os.getenv('POS_DEMO_GUEST_SHORT_ACCOUNT', 'guest').strip() or 'guest',
        'short_password': os.getenv('POS_DEMO_GUEST_SHORT_PASSWORD', '2026'),
    }


def ensure_demo_guest(session: Session) -> Optional[User]:
    """在系统已有管理员后，确保作品集演示用访客角色与账号可用。"""
    config = demo_guest_config()
    if not config['enabled']:
        existing_user = session.scalar(select(User).where(User.username == config['username']))
        if existing_user and any(role.code == 'guest' for role in existing_user.roles):
            existing_user.status = 'disabled'
            now = datetime.utcnow()
            for auth_session in existing_user.sessions:
                if auth_session.revoked_at is None:
                    auth_session.revoked_at = now
        return None
    has_admin = any(
        any(role.code == 'superadmin' for role in user.roles)
        for user in session.scalars(select(User)).all()
    )
    if not has_admin:
        return None

    permissions = {
        item.code: item
        for item in session.scalars(select(Permission).where(Permission.code.in_(GUEST_PERMISSION_CODES))).all()
    }
    role = session.scalar(select(Role).where(Role.code == 'guest'))
    if role is None:
        role = Role(
            code='guest',
            name='访客',
            description='作品集演示账号：可查看全部非超级管理员信息，仅可操作本人创建的业务数据。',
            default_view='tables',
            is_system=False,
        )
        session.add(role)
    role.permissions = [permissions[code] for code in sorted(permissions)]

    user = session.scalar(select(User).where(User.username == config['username']))
    if user is None:
        user = User(
            username=str(config['username']),
            employee_no='GUEST',
            short_account=str(config['short_account']),
            display_name='访客用户',
            password_hash=hash_secret(str(config['password'])),
            pin_hash=hash_secret(str(config['short_password'])),
            status='active',
            must_change_password=False,
            data_scope='own_created',
            roles=[role],
        )
        session.add(user)
    else:
        user.status = 'active'
        user.must_change_password = False
        user.data_scope = 'own_created'
        user.roles = [role]
        if not verify_secret(user.password_hash, str(config['password'])):
            user.password_hash = hash_secret(str(config['password']))
        if not user.pin_hash or not verify_secret(user.pin_hash, str(config['short_password'])):
            user.pin_hash = hash_secret(str(config['short_password']))
    return user


def permission_codes_for_user(user: User) -> Set[str]:
    return {permission.code for role in user.roles for permission in role.permissions}


def role_to_dict(role: Role, include_permissions: bool = True) -> dict:
    result = {
        'id': role.id,
        'code': role.code,
        'name': role.name,
        'description': role.description,
        'is_system': role.is_system,
        'default_view': role.default_view,
        'user_count': len(role.users),
        'created_by_user_id': role.created_by_user_id,
    }
    if include_permissions:
        result['permissions'] = sorted(permission.code for permission in role.permissions)
    return result


def user_to_dict(user: User, include_permissions: bool = True) -> dict:
    display_status = 'disabled' if user.status == 'disabled' else (
        'password_change_required' if user.must_change_password or user.status == 'password_change_required' else 'active'
    )
    result = {
        'id': user.id,
        'username': user.username,
        'employee_no': user.employee_no,
        'short_account': user.short_account,
        'display_name': user.display_name,
        'phone': user.phone,
        'status': display_status,
        'roles': [role_to_dict(role, include_permissions=False) for role in user.roles],
        'last_login_at': utc_iso(user.last_login_at),
        'last_action_at': utc_iso(user.last_action_at),
        'locked_until': utc_iso(user.locked_until),
        'created_at': utc_iso(user.created_at),
        'data_scope': user.data_scope,
        'created_by_user_id': user.created_by_user_id,
    }
    if include_permissions:
        result['permissions'] = sorted(permission_codes_for_user(user))
    return result


def permission_catalog() -> List[dict]:
    return [
        {'code': code, 'module': module, 'action': action, 'description': description}
        for code, module, action, description in PERMISSION_DEFINITIONS
    ]
