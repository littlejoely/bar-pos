"""系统功能开关。"""
from flask import Blueprint, jsonify, request
import json
import os
import tempfile


system_settings_bp = Blueprint('system_settings', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
SETTINGS_FILE = os.path.join(DATA_DIR, 'system_settings.json')
DEFAULT_SETTINGS = {'production_ticket_enabled': True}


def load_system_settings():
    if not os.path.exists(SETTINGS_FILE):
        return dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
            return {**DEFAULT_SETTINGS, **(json.load(f) or {})}
    except (OSError, ValueError, TypeError):
        return dict(DEFAULT_SETTINGS)


def save_system_settings(settings):
    fd, temp_path = tempfile.mkstemp(prefix='.pos-bar-', suffix='.json', dir=DATA_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, SETTINGS_FILE)
    except Exception:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


def production_ticket_enabled():
    return load_system_settings().get('production_ticket_enabled') is True


@system_settings_bp.route('/system-settings', methods=['GET'])
def get_system_settings():
    return jsonify({'success': True, 'data': load_system_settings()})


@system_settings_bp.route('/system-settings', methods=['PATCH'])
def update_system_settings():
    data = request.get_json(silent=True) or {}
    settings = load_system_settings()
    if 'production_ticket_enabled' in data:
        settings['production_ticket_enabled'] = data.get('production_ticket_enabled') is True
    save_system_settings(settings)
    return jsonify({'success': True, 'data': settings})
