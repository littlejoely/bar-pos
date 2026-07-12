"""
桌台管理路由
"""
from flask import Blueprint, jsonify, request
import json
import os
import tempfile
from datetime import datetime

table_bp = Blueprint('table', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
TABLES_FILE = os.path.join(DATA_DIR, 'tables.json')
ORDERS_FILE = os.path.join(DATA_DIR, 'orders.json')


def atomic_json_save(path, data):
    fd, temp_path = tempfile.mkstemp(prefix='.pos-bar-', suffix='.json', dir=DATA_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, path)
    except Exception:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise

def load_table_data():
    with open(TABLES_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if 'areas' not in data:
        seen = []
        for t in data.get('tables', []):
            area = t.get('area')
            if area and area not in seen:
                seen.append(area)
        data['areas'] = [{'name': a} for a in seen]
        atomic_json_save(TABLES_FILE, data)
    return data


def save_table_data(data):
    atomic_json_save(TABLES_FILE, data)


def load_tables():
    return load_table_data()['tables']


def save_tables(tables):
    data = load_table_data()
    data['tables'] = tables
    save_table_data(data)


def load_areas():
    return load_table_data().get('areas', [])


def table_configuration_payload(data=None):
    if data is None:
        data = load_table_data()
    areas = data.get('areas', [])
    tables = data.get('tables', [])
    enriched = []
    for area in areas:
        name = area.get('name')
        area_tables = [t for t in tables if t.get('area') == name]
        enriched.append({'name': name, 'table_count': len(area_tables)})
    return {'areas': enriched, 'tables': tables}

def load_orders():
    try:
        with open(ORDERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)['orders']
    except:
        return []

def save_orders(orders):
    atomic_json_save(ORDERS_FILE, {'orders': orders})


def committed_items(order):
    return [
        item for item in (order.get('items', []) if order else [])
        if item.get('addition_pending') is not True and item.get('returned') is not True
    ]


def committed_total(order):
    return round(sum(
        item.get('line_total', item.get('price', 0) * item.get('quantity', 0)) or 0
        for item in committed_items(order)
    ), 2)


def order_balance_settled(order):
    if not order:
        return False
    subtotal = round(order.get('total', 0) or 0, 2)
    discount = order.get('order_discount', 0) or 0
    after_discount = round(subtotal * (1 - discount / 100), 2)
    after_reduction = round(after_discount - (order.get('order_reduction', 0) or 0), 2)
    voucher_amount = ((order.get('voucher') or {}).get('amount', 0) or 0)
    payable = max(0, round(
        after_reduction - voucher_amount - (order.get('round_down', 0) or 0),
        2,
    ))
    paid_total = round(sum(
        payment.get('amount', 0) or 0 for payment in order.get('payments', [])
    ), 2)
    return paid_total >= payable - 0.01

def enrich_table(table, orders):
    enriched = dict(table)
    order = next((
        o for o in orders
        if o['table_id'] == table['id'] and o.get('status') in ['pending', 'submitted', 'served']
    ), None)
    item_count = sum(i.get('quantity', 0) for i in committed_items(order))

    enriched['active_order_id'] = order.get('id') if order else None
    enriched['order_total'] = committed_total(order)
    enriched['item_count'] = item_count

    if table['status'] == 'empty':
        enriched['display_status'] = 'empty'
    elif table['status'] == 'pending_cleanup':
        enriched['display_status'] = 'pending_cleanup'
        paid_order = next((o for o in orders if o.get('id') == table.get('order_id')), None)
        enriched['order_total'] = paid_order.get('total', 0) if paid_order else enriched['order_total']
        enriched['item_count'] = sum(i.get('quantity', 0) for i in paid_order.get('items', [])) if paid_order else enriched['item_count']
    elif order and order.get('status') in ['submitted', 'served'] and order_balance_settled(order):
        enriched['display_status'] = 'settled'
    elif order and order.get('status') in ['submitted', 'served']:
        enriched['display_status'] = 'pending_checkout'
    else:
        enriched['display_status'] = 'opened'

    return enriched

@table_bp.route('/list', methods=['GET'])
def get_tables():
    """获取所有桌台列表"""
    tables = load_tables()
    orders = load_orders()
    return jsonify({'success': True, 'data': [enrich_table(t, orders) for t in tables]})

@table_bp.route('/<table_id>', methods=['GET'])
def get_table(table_id):
    """获取单个桌台信息"""
    tables = load_tables()
    orders = load_orders()
    table = next((t for t in tables if t['id'] == table_id), None)
    if table:
        return jsonify({'success': True, 'data': enrich_table(table, orders)})
    return jsonify({'success': False, 'error': '桌台不存在'}), 404

@table_bp.route('/<table_id>/open', methods=['POST'])
def open_table(table_id):
    """开台"""
    data = request.json or {}
    guests = data.get('guests')
    remark = (data.get('remark') or '').strip()

    tables = load_tables()
    table = next((t for t in tables if t['id'] == table_id), None)

    if not table:
        return jsonify({'success': False, 'error': '桌台不存在'}), 404

    if table['status'] != 'empty':
        return jsonify({'success': False, 'error': '桌台已被占用'}), 400

    if guests is None:
        guests = table.get('default_guests', 1)
    try:
        guests = int(guests)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '用餐人数无效'}), 400
    if guests < 1 or guests > 50:
        return jsonify({'success': False, 'error': '请输入 1-50 的用餐人数'}), 400

    table['status'] = 'occupied'
    table['guests'] = guests
    table['remark'] = remark
    table['opened_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    save_tables(tables)
    return jsonify({'success': True, 'data': table})

@table_bp.route('/<table_id>/guests', methods=['PUT'])
def update_guests(table_id):
    """修改用餐人数"""
    data = request.json or {}
    try:
        guests = int(data.get('guests', 1))
    except:
        return jsonify({'success': False, 'error': '用餐人数无效'}), 400

    if guests < 1 or guests > 50:
        return jsonify({'success': False, 'error': '请输入 1-50 的用餐人数'}), 400

    tables = load_tables()
    table = next((t for t in tables if t['id'] == table_id), None)

    if not table:
        return jsonify({'success': False, 'error': '桌台不存在'}), 404

    if table['status'] == 'empty':
        return jsonify({'success': False, 'error': '空桌不能修改人数'}), 400

    table['guests'] = guests
    save_tables(tables)

    orders = load_orders()
    order = next((o for o in orders if o.get('id') == table.get('order_id')), None)
    if not order:
        order = next((
            o for o in orders
            if o['table_id'] == table_id and o.get('status') in ['pending', 'submitted', 'served']
        ), None)
    if order:
        order['guests'] = guests
        save_orders(orders)

    return jsonify({'success': True, 'data': enrich_table(table, orders)})

@table_bp.route('/<table_id>/close', methods=['POST'])
def close_table(table_id):
    """清台"""
    tables = load_tables()
    table = next((t for t in tables if t['id'] == table_id), None)

    if not table:
        return jsonify({'success': False, 'error': '桌台不存在'}), 404

    orders = load_orders()
    order = next((o for o in orders if o.get('id') == table.get('order_id')), None)
    if order:
        cleared_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        order['cleared_at'] = cleared_at
        order.setdefault('operation_logs', []).append({
            'id': f"L{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            'time': cleared_at,
            'category': '桌台',
            'action': '清台',
            'detail': f'桌台 {table_id} 已清理并恢复为空桌',
            'operator': '收银员',
        })
        save_orders(orders)

    table['status'] = 'empty'
    table['guests'] = 0
    table['opened_at'] = None
    table['order_id'] = None

    save_tables(tables)
    return jsonify({'success': True, 'data': table})


@table_bp.route('/configuration', methods=['GET'])
def get_table_configuration():
    """获取桌区 + 桌台配置"""
    return jsonify({'success': True, 'data': table_configuration_payload()})


@table_bp.route('/area', methods=['POST'])
def add_table_area():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'error': '区域名称不能为空'}), 400

    td = load_table_data()
    areas = td.setdefault('areas', [])
    if any(a.get('name') == name for a in areas):
        return jsonify({'success': False, 'error': '区域已存在'}), 400

    new_area = {'name': name}
    position = data.get('position')
    try:
        position = int(position) if position is not None else None
    except (TypeError, ValueError):
        position = None
    if position is not None and position >= 1:
        idx = min(position - 1, len(areas))
        areas.insert(idx, new_area)
    else:
        areas.append(new_area)
    save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})


@table_bp.route('/area/<path:name>', methods=['PATCH'])
def rename_table_area(name):
    data = request.get_json(silent=True) or {}
    new_name = (data.get('name') or '').strip()
    if not new_name:
        return jsonify({'success': False, 'error': '区域名称不能为空'}), 400
    if new_name == name:
        return jsonify({'success': False, 'error': '新名称与原名称相同'}), 400

    td = load_table_data()
    areas = td.get('areas', [])
    if not any(a.get('name') == name for a in areas):
        return jsonify({'success': False, 'error': '区域不存在'}), 404
    if any(a.get('name') == new_name for a in areas):
        return jsonify({'success': False, 'error': '区域名称已存在'}), 400

    for a in areas:
        if a.get('name') == name:
            a['name'] = new_name
            break
    for t in td.get('tables', []):
        if t.get('area') == name:
            t['area'] = new_name

    save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})


@table_bp.route('/area/<path:name>', methods=['DELETE'])
def delete_table_area(name):
    td = load_table_data()
    tables_in_area = [t for t in td.get('tables', []) if t.get('area') == name]
    if tables_in_area:
        return jsonify({'success': False, 'error': '区域下还有桌台，请先删除桌台'}), 400

    td['areas'] = [a for a in td.get('areas', []) if a.get('name') != name]
    save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})


@table_bp.route('/area/<path:name>/position', methods=['PUT'])
def set_table_area_position(name):
    data = request.get_json(silent=True) or {}
    try:
        position = int(data.get('position'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '位置无效'}), 400
    if position < 1:
        return jsonify({'success': False, 'error': '位置必须大于等于 1'}), 400

    td = load_table_data()
    areas = td.get('areas', [])
    current_idx = next((i for i, a in enumerate(areas) if a.get('name') == name), None)
    if current_idx is None:
        return jsonify({'success': False, 'error': '区域不存在'}), 404

    target_idx = min(position - 1, len(areas) - 1)
    if target_idx != current_idx:
        area = areas.pop(current_idx)
        areas.insert(target_idx, area)
        save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})


@table_bp.route('/definition', methods=['POST'])
def add_table_definition():
    data = request.get_json(silent=True) or {}
    table_id = (data.get('id') or '').strip()
    area = (data.get('area') or '').strip()
    if not table_id:
        return jsonify({'success': False, 'error': '桌台编号不能为空'}), 400
    if not area:
        return jsonify({'success': False, 'error': '请选择区域'}), 400

    try:
        default_guests = int(data.get('default_guests', 1))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '默认人数无效'}), 400
    if default_guests < 1 or default_guests > 50:
        return jsonify({'success': False, 'error': '默认人数应在 1-50 之间'}), 400

    td = load_table_data()
    if not any(a.get('name') == area for a in td.get('areas', [])):
        return jsonify({'success': False, 'error': '区域不存在'}), 400
    if any(t.get('id') == table_id for t in td.get('tables', [])):
        return jsonify({'success': False, 'error': '桌台编号已存在'}), 400

    new_table = {
        'id': table_id,
        'area': area,
        'status': 'empty',
        'guests': 0,
        'opened_at': None,
        'order_id': None,
        'default_guests': default_guests,
    }

    tables = td.setdefault('tables', [])
    position = data.get('position')
    try:
        position = int(position) if position is not None else None
    except (TypeError, ValueError):
        position = None
    area_tables = [t for t in tables if t.get('area') == area]
    if position is not None and position >= 1:
        if area_tables:
            rel_idx = min(position - 1, len(area_tables))
            target = area_tables[rel_idx] if rel_idx < len(area_tables) else area_tables[-1]
            target_global = tables.index(target)
            tables.insert(target_global + (1 if rel_idx >= len(area_tables) else 0), new_table)
        else:
            area_idx_in_list = next(
                (i for i, a in enumerate(td.get('areas', [])) if a.get('name') == area),
                len(td.get('areas', [])) - 1,
            )
            insert_idx = len(tables)
            for a in td.get('areas', [])[area_idx_in_list + 1:]:
                for i, t in enumerate(tables):
                    if t.get('area') == a.get('name'):
                        insert_idx = i
                        break
                else:
                    continue
                break
            tables.insert(insert_idx, new_table)
    elif area_tables:
        last_area_idx = max(i for i, t in enumerate(tables) if t.get('area') == area)
        tables.insert(last_area_idx + 1, new_table)
    else:
        area_idx_in_list = next(
            (i for i, a in enumerate(td.get('areas', [])) if a.get('name') == area),
            len(td.get('areas', [])) - 1,
        )
        insert_idx = len(tables)
        for a in td.get('areas', [])[area_idx_in_list + 1:]:
            for i, t in enumerate(tables):
                if t.get('area') == a.get('name'):
                    insert_idx = i
                    break
            else:
                continue
            break
        tables.insert(insert_idx, new_table)

    save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})


@table_bp.route('/definition/<table_id>', methods=['PATCH'])
def update_table_definition(table_id):
    data = request.get_json(silent=True) or {}
    new_id = (data.get('id') or '').strip() if 'id' in data else None
    new_area = (data.get('area') or '').strip() if 'area' in data else None
    has_default_guests = 'default_guests' in data

    td = load_table_data()
    tables = td.get('tables', [])
    table = next((t for t in tables if t.get('id') == table_id), None)
    if not table:
        return jsonify({'success': False, 'error': '桌台不存在'}), 404

    if (new_id is not None or new_area is not None) and table.get('status') != 'empty':
        return jsonify({'success': False, 'error': '桌台非空时不能修改编号或区域'}), 400

    if new_id is not None and new_id != table_id:
        if any(t.get('id') == new_id for t in tables):
            return jsonify({'success': False, 'error': '桌台编号已存在'}), 400
        table['id'] = new_id

    if new_area is not None and new_area != table.get('area'):
        if not any(a.get('name') == new_area for a in td.get('areas', [])):
            return jsonify({'success': False, 'error': '区域不存在'}), 400
        table['area'] = new_area

    if has_default_guests:
        try:
            default_guests = int(data.get('default_guests'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': '默认人数无效'}), 400
        if default_guests < 1 or default_guests > 50:
            return jsonify({'success': False, 'error': '默认人数应在 1-50 之间'}), 400
        table['default_guests'] = default_guests

    save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})


@table_bp.route('/definition/<table_id>', methods=['DELETE'])
def delete_table_definition(table_id):
    td = load_table_data()
    tables = td.get('tables', [])
    table = next((t for t in tables if t.get('id') == table_id), None)
    if not table:
        return jsonify({'success': False, 'error': '桌台不存在'}), 404
    if table.get('status') != 'empty':
        return jsonify({'success': False, 'error': '桌台非空时不能删除'}), 400

    td['tables'] = [t for t in tables if t.get('id') != table_id]
    save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})


def _find_table_insert_index(tables, area, position):
    """Find global index to insert a table at 1-based `position` within `area`."""
    area_indices = [i for i, t in enumerate(tables) if t.get('area') == area]
    if not area_indices:
        return len(tables)
    if position > len(area_indices):
        return area_indices[-1] + 1
    return area_indices[position - 1]


@table_bp.route('/definition/<table_id>/position', methods=['PUT'])
def relocate_table_definition(table_id):
    data = request.get_json(silent=True) or {}
    target_area = (data.get('area') or '').strip()
    try:
        position = int(data.get('position'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '位置无效'}), 400
    if not target_area:
        return jsonify({'success': False, 'error': '请指定目标区域'}), 400
    if position < 1:
        return jsonify({'success': False, 'error': '位置必须大于等于 1'}), 400

    td = load_table_data()
    if not any(a.get('name') == target_area for a in td.get('areas', [])):
        return jsonify({'success': False, 'error': '目标区域不存在'}), 400

    tables = td.get('tables', [])
    source_idx = next((i for i, t in enumerate(tables) if t.get('id') == table_id), None)
    if source_idx is None:
        return jsonify({'success': False, 'error': '桌台不存在'}), 404

    table = tables[source_idx]
    if table.get('status') != 'empty':
        return jsonify({'success': False, 'error': '桌台非空时不能移动'}), 400

    tables.pop(source_idx)
    if table.get('area') != target_area:
        table['area'] = target_area
    insert_idx = _find_table_insert_index(tables, target_area, position)
    tables.insert(insert_idx, table)

    save_table_data(td)
    return jsonify({'success': True, 'data': table_configuration_payload(td)})
