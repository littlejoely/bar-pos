"""优惠券配置路由。"""
from flask import Blueprint, g, jsonify, request
from auth.middleware import require_permission
import json
import os
import tempfile


voucher_bp = Blueprint('voucher', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
VOUCHER_FILE = os.path.join(DATA_DIR, 'vouchers.json')


def load_vouchers():
    if not os.path.exists(VOUCHER_FILE):
        return []
    with open(VOUCHER_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def save_vouchers(vouchers):
    fd, temp_path = tempfile.mkstemp(prefix='.pos-bar-', suffix='.json', dir=DATA_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(vouchers, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, VOUCHER_FILE)
    except Exception:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


def parse_voucher_payload(data):
    name = (data.get('name') or '').strip()
    if not name:
        return None, '优惠券名称不能为空'
    try:
        sale_price = round(float(data.get('sale_price') or 0), 2)
        face_value = round(float(data.get('face_value') or 0), 2)
    except (TypeError, ValueError):
        return None, '售价或抵扣金额无效'
    if sale_price < 0:
        return None, '售价不能为负数'
    if face_value <= 0:
        return None, '抵扣金额必须大于 0'
    if sale_price > face_value:
        return None, '售价不能高于抵扣金额'
    return {
        'name': name,
        'sale_price': sale_price,
        'face_value': face_value,
    }, None


def public_voucher_payload(vouchers):
    scoped_user = getattr(getattr(g, 'current_user', None), 'data_scope', 'all') == 'own_created'
    result = []
    for voucher in vouchers:
        public_voucher = {key: value for key, value in voucher.items() if not key.startswith('_')}
        if scoped_user:
            public_voucher['owned_by_current_user'] = voucher.get('_created_by_user_id') == g.current_user.id
        result.append(public_voucher)
    return result


@voucher_bp.route('/vouchers', methods=['GET'])
@require_permission('voucher.view')
def get_vouchers():
    return jsonify({'success': True, 'data': public_voucher_payload(load_vouchers())})


@voucher_bp.route('/vouchers', methods=['POST'])
@require_permission('voucher.create')
def add_voucher():
    payload, error = parse_voucher_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({'success': False, 'error': error}), 400
    vouchers = load_vouchers()
    if any(v.get('name') == payload['name'] for v in vouchers):
        return jsonify({'success': False, 'error': '优惠券名称已存在'}), 400
    next_id = max((int(v.get('id', 0)) for v in vouchers), default=0) + 1
    voucher = {
        'id': next_id,
        **payload,
        '_created_by_user_id': g.current_user.id,
        '_created_by_user_name': g.current_user.display_name,
    }
    vouchers.append(voucher)
    save_vouchers(vouchers)
    return jsonify({'success': True, 'data': public_voucher_payload(vouchers)})


@voucher_bp.route('/vouchers/<int:voucher_id>', methods=['PATCH'])
@require_permission('voucher.edit')
def update_voucher(voucher_id):
    payload, error = parse_voucher_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({'success': False, 'error': error}), 400
    vouchers = load_vouchers()
    voucher = next((v for v in vouchers if v.get('id') == voucher_id), None)
    if not voucher:
        return jsonify({'success': False, 'error': '优惠券不存在'}), 404
    if any(v.get('id') != voucher_id and v.get('name') == payload['name'] for v in vouchers):
        return jsonify({'success': False, 'error': '优惠券名称已存在'}), 400
    voucher.update(payload)
    save_vouchers(vouchers)
    return jsonify({'success': True, 'data': public_voucher_payload(vouchers)})


@voucher_bp.route('/vouchers/<int:voucher_id>', methods=['DELETE'])
@require_permission('voucher.delete')
def delete_voucher(voucher_id):
    vouchers = load_vouchers()
    if not any(v.get('id') == voucher_id for v in vouchers):
        return jsonify({'success': False, 'error': '优惠券不存在'}), 404
    vouchers = [v for v in vouchers if v.get('id') != voucher_id]
    save_vouchers(vouchers)
    return jsonify({'success': True, 'data': public_voucher_payload(vouchers)})
