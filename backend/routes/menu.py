"""
菜单路由
"""
from flask import Blueprint, jsonify, request, send_file
from datetime import datetime
from io import BytesIO
import json
import os

menu_bp = Blueprint('menu', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
MENU_FILE = os.path.join(DATA_DIR, 'menu.json')
SALE_STATUSES = {'on_sale', 'off_sale'}


def load_menu():
    with open(MENU_FILE, 'r', encoding='utf-8') as f:
        menu = json.load(f)
    for category in menu.get('categories', []):
        for item in category.get('items', []):
            item.setdefault('sale_status', 'on_sale')
    return menu


def save_menu(data):
    with open(MENU_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def next_item_id(menu):
    ids = [
        item.get('id', 0)
        for cat in menu.get('categories', [])
        for item in cat.get('items', [])
    ]
    return (max(ids) if ids else 0) + 1


def build_item_export(menu, selected_ids):
    """按菜单中的类别与类别内顺序导出商品。"""
    try:
        from openpyxl import Workbook
    except ImportError as exc:
        raise RuntimeError('Excel 导出组件尚未安装，请安装 openpyxl') from exc

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = '商品管理'
    sheet.append(['全部序号', '类别', '类别排序', '中文名', '英文名', '价格', '售卖状态', 'ABV', '商品描述'])

    global_position = 0
    for category in menu.get('categories', []):
        category_name = category.get('name', '')
        for category_position, item in enumerate(category.get('items', []), start=1):
            global_position += 1
            if item.get('id') not in selected_ids:
                continue
            sheet.append([
                global_position,
                category_name,
                category_position,
                item.get('name', ''),
                item.get('english_name', ''),
                item.get('price', 0),
                '已下架' if item.get('sale_status') == 'off_sale' else '在售',
                item.get('abv', ''),
                item.get('description', ''),
            ])

    sheet.freeze_panes = 'A2'
    sheet.auto_filter.ref = sheet.dimensions
    for column_cells in sheet.columns:
        max_length = max(len(str(cell.value or '')) for cell in column_cells)
        sheet.column_dimensions[column_cells[0].column_letter].width = min(42, max(10, max_length + 2))

    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output


@menu_bp.route('/menu', methods=['GET'])
def get_menu():
    return jsonify({'success': True, 'data': load_menu()})


@menu_bp.route('/menu/items/export', methods=['POST'])
def export_items():
    data = request.get_json(silent=True) or {}
    item_ids = data.get('item_ids')
    if not isinstance(item_ids, list):
        return jsonify({'success': False, 'error': '请选择需要导出的商品'}), 400
    selected_ids = set()
    for item_id in item_ids:
        try:
            selected_ids.add(int(item_id))
        except (TypeError, ValueError):
            continue
    if not selected_ids:
        return jsonify({'success': False, 'error': '没有可导出的商品'}), 400

    menu = load_menu()
    existing_ids = {
        item.get('id')
        for category in menu.get('categories', [])
        for item in category.get('items', [])
    }
    selected_ids &= existing_ids
    if not selected_ids:
        return jsonify({'success': False, 'error': '没有可导出的商品'}), 400
    try:
        output = build_item_export(menu, selected_ids)
    except RuntimeError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 503
    filename = f"商品管理-{datetime.now().strftime('%Y%m%d-%H%M%S')}.xlsx"
    return send_file(
        output,
        as_attachment=True,
        download_name=filename,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )


@menu_bp.route('/shop', methods=['GET'])
def get_shop():
    data = load_menu()
    return jsonify({'success': True, 'data': {'name': data.get('shop_name', '示例店铺')}})


@menu_bp.route('/menu/category', methods=['POST'])
def add_category():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'error': '类别名称不能为空'}), 400

    menu = load_menu()
    categories = menu.setdefault('categories', [])
    if any(c.get('name') == name for c in categories):
        return jsonify({'success': False, 'error': '类别已存在'}), 400

    new_category = {'name': name, 'items': []}
    position = data.get('position')
    try:
        position = int(position) if position is not None else None
    except (TypeError, ValueError):
        position = None
    if position is not None and position >= 1:
        idx = min(position - 1, len(categories))
        categories.insert(idx, new_category)
    else:
        categories.append(new_category)
    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


@menu_bp.route('/menu/category/<path:name>', methods=['DELETE'])
def delete_category(name):
    menu = load_menu()
    categories = menu.get('categories', [])
    target = next((c for c in categories if c.get('name') == name), None)
    if not target:
        return jsonify({'success': False, 'error': '类别不存在'}), 404

    item_count = len(target.get('items') or [])
    menu['categories'] = [c for c in categories if c.get('name') != name]
    save_menu(menu)
    return jsonify({'success': True, 'data': menu, 'deleted_item_count': item_count})


@menu_bp.route('/menu/category/<path:name>', methods=['PATCH'])
def rename_category(name):
    data = request.get_json(silent=True) or {}
    new_name = (data.get('name') or '').strip()
    if not new_name:
        return jsonify({'success': False, 'error': '类别名称不能为空'}), 400
    if new_name == name:
        return jsonify({'success': False, 'error': '新名称与原名称相同'}), 400

    menu = load_menu()
    categories = menu.get('categories', [])
    if not any(c.get('name') == name for c in categories):
        return jsonify({'success': False, 'error': '类别不存在'}), 404
    if any(c.get('name') == new_name for c in categories):
        return jsonify({'success': False, 'error': '类别名称已存在'}), 400

    for c in categories:
        if c.get('name') == name:
            c['name'] = new_name
            break
    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


@menu_bp.route('/menu/category/<path:name>/move', methods=['PUT'])
def move_category(name):
    data = request.get_json(silent=True) or {}
    direction = data.get('direction')
    if direction not in ('up', 'down'):
        return jsonify({'success': False, 'error': '方向无效'}), 400

    menu = load_menu()
    categories = menu.get('categories', [])
    index = next((i for i, c in enumerate(categories) if c.get('name') == name), None)
    if index is None:
        return jsonify({'success': False, 'error': '类别不存在'}), 404

    if direction == 'up' and index > 0:
        categories[index], categories[index - 1] = categories[index - 1], categories[index]
    elif direction == 'down' and index < len(categories) - 1:
        categories[index], categories[index + 1] = categories[index + 1], categories[index]
    else:
        return jsonify({'success': True, 'data': menu})

    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


@menu_bp.route('/menu/category/<path:name>/position', methods=['PUT'])
def set_category_position(name):
    data = request.get_json(silent=True) or {}
    try:
        position = int(data.get('position'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '位置无效'}), 400
    if position < 1:
        return jsonify({'success': False, 'error': '位置必须大于等于 1'}), 400

    menu = load_menu()
    categories = menu.get('categories', [])
    current_idx = next((i for i, c in enumerate(categories) if c.get('name') == name), None)
    if current_idx is None:
        return jsonify({'success': False, 'error': '类别不存在'}), 404

    target_idx = min(position - 1, len(categories) - 1)
    if target_idx == current_idx:
        return jsonify({'success': True, 'data': menu})

    category = categories.pop(current_idx)
    categories.insert(target_idx, category)
    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


def find_item(menu, item_id):
    for category in menu.get('categories', []):
        for idx, item in enumerate(category.get('items', [])):
            if item.get('id') == item_id:
                return category, idx, item
    return None, None, None


@menu_bp.route('/menu/item/<int:item_id>', methods=['PATCH'])
def update_item(item_id):
    data = request.get_json(silent=True) or {}
    menu = load_menu()
    category, idx, item = find_item(menu, item_id)
    if item is None:
        return jsonify({'success': False, 'error': '商品不存在'}), 404

    new_category_name = (data.get('category') or '').strip() if 'category' in data else None

    if 'name' in data:
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': '商品名称不能为空'}), 400
        item['name'] = name

    if 'price' in data:
        try:
            price = float(data.get('price'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': '价格无效'}), 400
        if price < 0:
            return jsonify({'success': False, 'error': '价格不能为负'}), 400
        item['price'] = price

    if 'sale_status' in data:
        sale_status = data.get('sale_status')
        if sale_status not in SALE_STATUSES:
            return jsonify({'success': False, 'error': '售卖状态无效'}), 400
        item['sale_status'] = sale_status

    for field in ('english_name', 'abv', 'description'):
        if field in data:
            value = (data.get(field) or '').strip()
            if value:
                item[field] = value
            else:
                item.pop(field, None)

    if new_category_name is not None:
        target = next((c for c in menu.get('categories', []) if c.get('name') == new_category_name), None)
        if not target:
            return jsonify({'success': False, 'error': '目标类别不存在'}), 400
        if target is not category:
            category['items'].pop(idx)
            target.setdefault('items', []).append(item)

    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


@menu_bp.route('/menu/items/batch-update', methods=['PUT'])
def batch_update_items():
    data = request.get_json(silent=True) or {}
    raw_item_ids = data.get('item_ids')
    if not isinstance(raw_item_ids, list):
        return jsonify({'success': False, 'error': '请选择需要修改的商品'}), 400
    item_ids = set()
    for item_id in raw_item_ids:
        try:
            item_ids.add(int(item_id))
        except (TypeError, ValueError):
            continue
    if not item_ids:
        return jsonify({'success': False, 'error': '请选择需要修改的商品'}), 400

    has_category = 'category' in data and data.get('category') is not None
    has_price = 'price' in data and data.get('price') is not None
    has_sale_status = 'sale_status' in data and data.get('sale_status') is not None
    has_abv = 'abv' in data and data.get('abv') is not None
    if not any((has_category, has_price, has_sale_status, has_abv)):
        return jsonify({'success': False, 'error': '请至少选择一项批量修改内容'}), 400

    target_category_name = (data.get('category') or '').strip() if has_category else None
    if has_price:
        try:
            price = float(data.get('price'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': '统一价格无效'}), 400
        if price < 0:
            return jsonify({'success': False, 'error': '统一价格不能为负'}), 400
    else:
        price = None
    sale_status = data.get('sale_status') if has_sale_status else None
    if has_sale_status and sale_status not in SALE_STATUSES:
        return jsonify({'success': False, 'error': '售卖状态无效'}), 400
    abv = (data.get('abv') or '').strip() if has_abv else None

    menu = load_menu()
    categories = menu.get('categories', [])
    target_category = None
    if has_category:
        target_category = next((c for c in categories if c.get('name') == target_category_name), None)
        if not target_category:
            return jsonify({'success': False, 'error': '目标类别不存在'}), 400

    matched_items = [
        item
        for category in categories
        for item in category.get('items', [])
        if item.get('id') in item_ids
    ]
    if len(matched_items) != len(item_ids):
        return jsonify({'success': False, 'error': '部分商品不存在，请刷新后重试'}), 400

    for item in matched_items:
        if has_price:
            item['price'] = price
        if has_sale_status:
            item['sale_status'] = sale_status
        if has_abv:
            if abv:
                item['abv'] = abv
            else:
                item.pop('abv', None)

    if has_category and target_category is not None:
        moving_items = []
        for category in categories:
            if category is target_category:
                continue
            retained_items = []
            for item in category.get('items', []):
                if item.get('id') in item_ids:
                    moving_items.append(item)
                else:
                    retained_items.append(item)
            category['items'] = retained_items
        target_category.setdefault('items', []).extend(moving_items)

    save_menu(menu)
    return jsonify({'success': True, 'data': menu, 'updated_count': len(matched_items)})


@menu_bp.route('/menu/item/<int:item_id>/move', methods=['PUT'])
def move_item(item_id):
    data = request.get_json(silent=True) or {}
    direction = data.get('direction')
    if direction not in ('up', 'down'):
        return jsonify({'success': False, 'error': '方向无效'}), 400

    menu = load_menu()
    category, idx, item = find_item(menu, item_id)
    if item is None:
        return jsonify({'success': False, 'error': '商品不存在'}), 404

    items = category.get('items', [])
    if direction == 'up' and idx > 0:
        items[idx], items[idx - 1] = items[idx - 1], items[idx]
    elif direction == 'down' and idx < len(items) - 1:
        items[idx], items[idx + 1] = items[idx + 1], items[idx]
    else:
        return jsonify({'success': True, 'data': menu})

    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


@menu_bp.route('/menu/item/<int:item_id>/relocate', methods=['PUT'])
def relocate_item(item_id):
    data = request.get_json(silent=True) or {}
    target_category_name = (data.get('category') or '').strip()
    try:
        position = int(data.get('position'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '位置无效'}), 400
    if not target_category_name:
        return jsonify({'success': False, 'error': '请指定目标类别'}), 400
    if position < 1:
        return jsonify({'success': False, 'error': '位置必须大于等于 1'}), 400

    menu = load_menu()
    source_category, source_idx, item = find_item(menu, item_id)
    if item is None:
        return jsonify({'success': False, 'error': '商品不存在'}), 404

    target_category = next(
        (c for c in menu.get('categories', []) if c.get('name') == target_category_name),
        None,
    )
    if not target_category:
        return jsonify({'success': False, 'error': '目标类别不存在'}), 400

    source_category['items'].pop(source_idx)
    target_items = target_category.setdefault('items', [])
    target_idx = min(position - 1, len(target_items))
    target_items.insert(target_idx, item)

    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


@menu_bp.route('/menu/item', methods=['POST'])
def add_item():
    data = request.get_json(silent=True) or {}
    category_name = (data.get('category') or '').strip()
    name = (data.get('name') or '').strip()
    price = data.get('price')

    if not category_name:
        return jsonify({'success': False, 'error': '请选择类别'}), 400
    if not name:
        return jsonify({'success': False, 'error': '商品名称不能为空'}), 400
    try:
        price = float(price)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '价格无效'}), 400
    if price < 0:
        return jsonify({'success': False, 'error': '价格不能为负'}), 400

    menu = load_menu()
    category = next(
        (c for c in menu.get('categories', []) if c.get('name') == category_name),
        None,
    )
    if not category:
        return jsonify({'success': False, 'error': '类别不存在'}), 400

    sale_status = data.get('sale_status', 'on_sale')
    if sale_status not in SALE_STATUSES:
        return jsonify({'success': False, 'error': '售卖状态无效'}), 400
    new_item = {
        'id': next_item_id(menu),
        'name': name,
        'price': price,
        'sale_status': sale_status,
    }
    for field in ('english_name', 'abv', 'description'):
        value = (data.get(field) or '').strip()
        if value:
            new_item[field] = value

    items = category.setdefault('items', [])
    position = data.get('position')
    try:
        position = int(position) if position is not None else None
    except (TypeError, ValueError):
        position = None
    if position is not None and position >= 1:
        idx = min(position - 1, len(items))
        items.insert(idx, new_item)
    else:
        items.append(new_item)
    save_menu(menu)
    return jsonify({'success': True, 'data': menu})


@menu_bp.route('/menu/item/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    menu = load_menu()
    for category in menu.get('categories', []):
        items = category.get('items', [])
        if any(i.get('id') == item_id for i in items):
            category['items'] = [i for i in items if i.get('id') != item_id]
            save_menu(menu)
            return jsonify({'success': True, 'data': menu})
    return jsonify({'success': False, 'error': '商品不存在'}), 404
