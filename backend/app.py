"""
POS-Bar 轻量餐饮收银系统 - Flask 后端
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import os

app = Flask(__name__, static_folder='../frontend/dist', static_url_path='')
CORS(app)

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

    app.register_blueprint(table_bp, url_prefix='/api/table')
    app.register_blueprint(order_bp, url_prefix='/api/order')
    app.register_blueprint(menu_bp, url_prefix='/api')
    app.register_blueprint(voucher_bp, url_prefix='/api')
    app.register_blueprint(system_settings_bp, url_prefix='/api')

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
    app.run(host='0.0.0.0', port=27779, debug=False)
