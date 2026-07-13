"""
POS-Bar 轻量餐饮收银系统 - Flask 后端
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import os

from auth import init_auth_database, install_auth_middleware

app = Flask(__name__, static_folder='../frontend/dist', static_url_path='')
cors_origins = [value.strip() for value in os.getenv('POS_CORS_ORIGINS', 'http://localhost:27778,http://127.0.0.1:27778').split(',') if value.strip()]
CORS(app, supports_credentials=True, origins=cors_origins)
init_auth_database(app)

# 数据目录
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

# 健康检查
@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'message': 'POS-Bar is running'})

# 注册路由
with app.app_context():
    from routes.table import table_bp
    from routes.order import order_bp
    from routes.menu import menu_bp
    from routes.voucher import voucher_bp
    from routes.system_settings import system_settings_bp
    from routes.auth import auth_bp
    from routes.users import users_bp
    from routes.roles import roles_bp
    from routes.audit_logs import audit_logs_bp

    app.register_blueprint(table_bp, url_prefix='/api/table')
    app.register_blueprint(order_bp, url_prefix='/api/order')
    app.register_blueprint(menu_bp, url_prefix='/api')
    app.register_blueprint(voucher_bp, url_prefix='/api')
    app.register_blueprint(system_settings_bp, url_prefix='/api')
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(users_bp, url_prefix='/api/users')
    app.register_blueprint(roles_bp, url_prefix='/api/roles')
    app.register_blueprint(audit_logs_bp, url_prefix='/api/audit-logs')

install_auth_middleware(app)


@app.after_request
def apply_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    return response

# 前端静态文件路由
@app.route('/')
def index():
    try:
        return app.send_static_file('index.html')
    except:
        return jsonify({'error': '前端未构建'})

@app.route('/assets/<path:path>')
def assets(path):
    return app.send_static_file(f'assets/{path}')

if __name__ == '__main__':
    os.makedirs(DATA_DIR, exist_ok=True)
    # 业务数据仍为 JSON load-modify-save；迁移事务型数据库前保持单写线程。
    app.run(host='0.0.0.0', port=27779, debug=False, threaded=False)
