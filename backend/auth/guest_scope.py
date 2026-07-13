from __future__ import annotations

from flask import g, jsonify, request


GUEST_ROLE_CODE = 'guest'
READ_LIKE_POST_ENDPOINTS = {
    'menu.export_items',
    'order.export_orders',
    'order.export_ticket_history',
    'audit_logs.export_audit_logs',
}


def is_guest_user(user=None) -> bool:
    user = user or getattr(g, 'current_user', None)
    return bool(user and (
        getattr(user, 'data_scope', 'all') == 'own_created'
        or any(role.code == GUEST_ROLE_CODE for role in user.roles)
    ))


def _denied():
    return jsonify({
        'success': False,
        'error': '访客账号只能操作本人创建的演示数据，现有数据为只读',
        'code': 'GUEST_DATA_SCOPE_DENIED',
    }), 403


def _orders_and_tables():
    # 延迟导入避免认证模块与业务蓝图形成循环依赖。
    from routes.order import load_orders, load_tables
    return load_orders(), load_tables()


def _order_owned(order) -> bool:
    return bool(order and order.get('created_by_user_id') == g.current_user.id)


def _table_owned(table_id: str, orders=None, tables=None) -> bool:
    if orders is None or tables is None:
        orders, tables = _orders_and_tables()
    table = next((item for item in tables if item.get('id') == table_id), None)
    if table and table.get('_active_owner_user_id') == g.current_user.id:
        return True
    if table and table.get('order_id'):
        order = next((item for item in orders if item.get('id') == table.get('order_id')), None)
        if _order_owned(order):
            return True
    order = next((
        item for item in orders
        if item.get('table_id') == table_id and item.get('status') in {'pending', 'submitted', 'served', 'paid'}
    ), None)
    return _order_owned(order)


def _record_owned(record) -> bool:
    return bool(record and record.get('_created_by_user_id') == g.current_user.id)


def _menu_scope(endpoint: str, view_args: dict):
    from routes.menu import find_item, load_menu
    if endpoint in {'menu.add_category', 'menu.add_item'}:
        return None
    menu = load_menu()
    if endpoint in {'menu.delete_category', 'menu.rename_category', 'menu.move_category', 'menu.set_category_position'}:
        category = next((item for item in menu.get('categories', []) if item.get('name') == view_args.get('name')), None)
        if not _record_owned(category):
            return _denied()
        if endpoint in {'menu.delete_category', 'menu.rename_category'} and any(not _record_owned(item) for item in category.get('items', [])):
            return _denied()
        return None
    if endpoint == 'menu.batch_update_items':
        raw_ids = (request.get_json(silent=True) or {}).get('item_ids') or []
        try:
            item_ids = {int(value) for value in raw_ids}
        except (TypeError, ValueError):
            return _denied()
        items = [item for category in menu.get('categories', []) for item in category.get('items', []) if item.get('id') in item_ids]
        return None if item_ids and len(items) == len(item_ids) and all(_record_owned(item) for item in items) else _denied()
    if 'item_id' in view_args:
        _category, _index, item = find_item(menu, int(view_args['item_id']))
        return None if _record_owned(item) else _denied()
    return _denied()


def _table_config_scope(endpoint: str, view_args: dict):
    from routes.table import load_table_data
    if endpoint in {'table.add_table_area', 'table.add_table_definition'}:
        return None
    data = load_table_data()
    if 'name' in view_args:
        area = next((item for item in data.get('areas', []) if item.get('name') == view_args.get('name')), None)
        if not _record_owned(area):
            return _denied()
        if endpoint in {'table.delete_table_area', 'table.rename_table_area'}:
            area_tables = [item for item in data.get('tables', []) if item.get('area') == view_args.get('name')]
            if any(not _record_owned(item) for item in area_tables):
                return _denied()
        return None
    if 'table_id' in view_args:
        table = next((item for item in data.get('tables', []) if item.get('id') == view_args.get('table_id')), None)
        return None if _record_owned(table) else _denied()
    return _denied()


def _identity_scope(endpoint: str, view_args: dict):
    from sqlalchemy import select
    from .database import get_auth_session
    from .models import Role, User
    db = get_auth_session()
    payload = request.get_json(silent=True) or {}
    if endpoint == 'roles.create_role':
        return None
    if endpoint == 'users.create_user':
        role_codes = [str(value) for value in payload.get('role_codes') or []]
        roles = list(db.scalars(select(Role).where(Role.code.in_(role_codes))).all()) if role_codes else []
        allowed = len(roles) == len(set(role_codes)) and all(
            role.code == GUEST_ROLE_CODE or role.created_by_user_id == g.current_user.id for role in roles
        )
        return None if allowed else _denied()
    if endpoint.startswith('users.') and view_args.get('user_id'):
        user = db.get(User, str(view_args['user_id']))
        return None if user and user.created_by_user_id == g.current_user.id else _denied()
    if endpoint.startswith('roles.') and view_args.get('role_id') is not None:
        role = db.get(Role, int(view_args['role_id']))
        if not role or role.created_by_user_id != g.current_user.id:
            return _denied()
        replacement_id = payload.get('replacement_role_id')
        if replacement_id is not None:
            replacement = db.get(Role, int(replacement_id))
            if not replacement or (replacement.code != GUEST_ROLE_CODE and replacement.created_by_user_id != g.current_user.id):
                return _denied()
        return None
    return _denied()


def enforce_guest_data_scope():
    """对访客的写请求执行资源归属校验；普通角色不受影响。"""
    if request.method in {'GET', 'HEAD', 'OPTIONS'} or not is_guest_user():
        return None

    endpoint = request.endpoint or ''
    if endpoint.startswith('auth.') or endpoint in READ_LIKE_POST_ENDPOINTS:
        return None

    view_args = request.view_args or {}

    if endpoint.startswith('menu.'):
        return _menu_scope(endpoint, view_args)

    if endpoint.startswith(('users.', 'roles.')):
        return _identity_scope(endpoint, view_args)

    if endpoint.startswith(('system_settings.', 'audit_logs.')):
        return _denied()

    if endpoint.startswith('voucher.'):
        from routes.voucher import load_vouchers
        if endpoint == 'voucher.add_voucher':
            return None
        voucher = next((item for item in load_vouchers() if item.get('id') == view_args.get('voucher_id')), None)
        return None if _record_owned(voucher) else _denied()

    table_config_endpoints = {
        'table.add_table_area', 'table.rename_table_area', 'table.delete_table_area', 'table.set_table_area_position',
        'table.add_table_definition', 'table.update_table_definition', 'table.delete_table_definition', 'table.relocate_table_definition',
    }
    if endpoint in table_config_endpoints:
        return _table_config_scope(endpoint, view_args)

    orders, tables = _orders_and_tables()

    if endpoint == 'table.open_table':
        table = next((item for item in tables if item.get('id') == view_args.get('table_id')), None)
        return None if table and table.get('status') == 'empty' else _denied()

    if endpoint.startswith('table.'):
        table_id = str(view_args.get('table_id', ''))
        return None if table_id and _table_owned(table_id, orders, tables) else _denied()

    if endpoint == 'order.refund_history_order':
        order = next((item for item in orders if item.get('id') == view_args.get('order_id')), None)
        return None if _order_owned(order) else _denied()

    if endpoint.startswith('order.'):
        table_id = str(view_args.get('table_id', ''))
        if not table_id or not _table_owned(table_id, orders, tables):
            return _denied()
        if endpoint == 'order.merge_table':
            target_id = str((request.get_json(silent=True) or {}).get('target_table_id', ''))
            if not target_id or not _table_owned(target_id, orders, tables):
                return _denied()
        return None

    # 新增写接口默认拒绝，避免后续功能忘记接入访客数据范围。
    return _denied()
