from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
_temporary_directory = tempfile.TemporaryDirectory(prefix='pos-bar-tests-')
os.environ['POS_AUTH_DATABASE_PATH'] = str(Path(_temporary_directory.name) / 'auth.db')
os.environ['POS_COOKIE_SECURE'] = 'false'

from app import app  # noqa: E402


class AuthPermissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        app.config.update(TESTING=True)
        cls.admin = app.test_client()
        response = cls.admin.post('/api/auth/bootstrap', json={
            'display_name': '测试管理员',
            'username': 'test-admin',
            'employee_no': 'T0001',
            'short_account': 'ta01',
            'password': 'TestAdmin123',
            'short_password': '2468',
        })
        assert response.status_code == 201, response.get_json()
        cls.admin_csrf = response.get_json()['data']['csrf_token']

    @classmethod
    def tearDownClass(cls) -> None:
        _temporary_directory.cleanup()

    @classmethod
    def admin_headers(cls) -> dict:
        return {'X-CSRF-Token': cls.admin_csrf}

    @classmethod
    def create_role(cls, code: str, permissions: list[str]) -> dict:
        response = cls.admin.post('/api/roles', headers=cls.admin_headers(), json={
            'code': code,
            'name': code,
            'description': '自动化测试角色',
            'default_view': 'tables',
            'permissions': permissions,
        })
        assert response.status_code == 201, response.get_json()
        return response.get_json()['data']

    @classmethod
    def create_user(cls, suffix: str, role_code: str) -> dict:
        response = cls.admin.post('/api/users', headers=cls.admin_headers(), json={
            'display_name': f'测试用户{suffix}',
            'username': f'user-{suffix}',
            'employee_no': f'E{suffix}',
            'short_account': f'u{suffix}',
            'password': 'UserPassword123',
            'short_password': '2580',
            'role_codes': [role_code],
        })
        assert response.status_code == 201, response.get_json()
        return response.get_json()['data']

    @staticmethod
    def login(username: str):
        client = app.test_client()
        response = client.post('/api/auth/login/password', json={
            'identifier': username,
            'password': 'UserPassword123',
        })
        assert response.status_code == 200, response.get_json()
        csrf = response.get_json()['data']['csrf_token']
        changed = client.put('/api/auth/password', headers={'X-CSRF-Token': csrf}, json={
            'current_password': 'UserPassword123',
            'new_password': 'ChangedPassword123',
        })
        assert changed.status_code == 200, changed.get_json()
        return client, csrf

    @staticmethod
    def login_guest():
        client = app.test_client()
        response = client.post('/api/auth/login/password', json={
            'identifier': 'visitor',
            'password': 'Visitor@2026',
        })
        assert response.status_code == 200, response.get_json()
        return client, response.get_json()['data']['csrf_token']

    def test_unauthenticated_business_api_is_rejected(self) -> None:
        client = app.test_client()
        response = client.get('/api/table/list')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['code'], 'AUTH_REQUIRED')

    def test_demo_guest_credentials_are_available_and_work(self) -> None:
        credentials = app.test_client().get('/api/auth/demo-credentials')
        self.assertEqual(credentials.status_code, 200)
        self.assertEqual(credentials.get_json()['data']['username'], 'visitor')
        client, _csrf = self.login_guest()
        self.assertEqual(client.get('/api/table/list').status_code, 200)

    def test_guest_cannot_modify_existing_order(self) -> None:
        client, csrf = self.login_guest()
        tables = [{'id': 'A1', 'status': 'occupied', 'order_id': 'O1', 'guests': 2}]
        orders = [{
            'id': 'O1', 'table_id': 'A1', 'status': 'pending', 'items': [],
            'created_by_user_id': 'someone-else',
        }]
        with patch('routes.order.load_tables', return_value=tables), \
                patch('routes.order.load_orders', return_value=orders):
            response = client.put(
                '/api/order/A1/remark',
                headers={'X-CSRF-Token': csrf},
                json={'remark': '不应写入'},
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['code'], 'GUEST_DATA_SCOPE_DENIED')

    def test_guest_can_open_table_and_create_owned_order(self) -> None:
        client, csrf = self.login_guest()
        tables = [{'id': 'A1', 'status': 'empty', 'guests': 0, 'default_guests': 2}]
        orders: list[dict] = []
        with patch('routes.order.load_tables', return_value=tables), \
                patch('routes.order.load_orders', return_value=orders), \
                patch('routes.order.save_tables'), \
                patch('routes.order.save_orders'), \
                patch('routes.table.load_tables', return_value=tables), \
                patch('routes.table.load_orders', return_value=orders), \
                patch('routes.table.save_tables'):
            opened = client.post(
                '/api/table/A1/open',
                headers={'X-CSRF-Token': csrf},
                json={'guests': 2},
            )
            created = client.post('/api/order/A1/create', headers={'X-CSRF-Token': csrf})
        self.assertEqual(opened.status_code, 200, opened.get_json())
        self.assertEqual(created.status_code, 200, created.get_json())
        self.assertEqual(created.get_json()['data']['created_by_user_id'], created.get_json()['data']['operation_logs'][0]['operator_id'])

    def test_guest_can_create_menu_data_but_cannot_edit_existing_data(self) -> None:
        client, csrf = self.login_guest()
        menu = {'categories': [{'name': '既有类别', 'items': [], '_created_by_user_id': 'someone-else'}]}
        with patch('routes.menu.load_menu', return_value=menu), patch('routes.menu.save_menu'):
            denied = client.patch(
                '/api/menu/category/%E6%97%A2%E6%9C%89%E7%B1%BB%E5%88%AB',
                headers={'X-CSRF-Token': csrf},
                json={'name': '不能修改'},
            )
            created = client.post(
                '/api/menu/category',
                headers={'X-CSRF-Token': csrf},
                json={'name': '访客类别'},
            )
            updated = client.patch(
                '/api/menu/category/%E8%AE%BF%E5%AE%A2%E7%B1%BB%E5%88%AB',
                headers={'X-CSRF-Token': csrf},
                json={'name': '访客类别已修改'},
            )
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(created.status_code, 200, created.get_json())
        self.assertEqual(updated.status_code, 200, updated.get_json())
        owned = next(item for item in updated.get_json()['data']['categories'] if item['name'] == '访客类别已修改')
        self.assertTrue(owned['owned_by_current_user'])

    def test_guest_created_user_keeps_own_created_data_scope(self) -> None:
        client, csrf = self.login_guest()
        role = client.post('/api/roles', headers={'X-CSRF-Token': csrf}, json={
            'code': 'guest_demo_role',
            'name': '访客演示角色',
            'default_view': 'tables',
            'permissions': ['table.view'],
        })
        self.assertEqual(role.status_code, 201, role.get_json())
        user = client.post('/api/users', headers={'X-CSRF-Token': csrf}, json={
            'display_name': '访客创建用户',
            'username': 'guest-created-user',
            'employee_no': 'GCU001',
            'short_account': 'gcu01',
            'password': 'GuestCreated123',
            'short_password': '3579',
            'role_codes': ['guest_demo_role'],
        })
        self.assertEqual(user.status_code, 201, user.get_json())
        self.assertEqual(user.get_json()['data']['data_scope'], 'own_created')
        self.assertIsNotNone(user.get_json()['data']['created_by_user_id'])

    def test_direct_api_calls_enforce_permissions(self) -> None:
        self.create_role('table_only', ['table.view'])
        self.create_user('101', 'table_only')
        client, csrf = self.login('user-101')

        self.assertEqual(client.get('/api/table/list').status_code, 200)
        denied = client.post('/api/order/export', headers={'X-CSRF-Token': csrf}, json={'order_ids': []})
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.get_json()['code'], 'PERMISSION_DENIED')
        self.assertEqual(denied.get_json()['permission'], 'history.export')
        self.assertEqual(client.get('/api/menu').status_code, 403)
        self.assertEqual(client.post('/api/order/A1/payment', headers={'X-CSRF-Token': csrf}, json={'method': '现金', 'amount': 1}).status_code, 403)
        self.assertEqual(client.post('/api/order/history/not-found/refund', headers={'X-CSRF-Token': csrf}, json={'amount': 1, 'reason': '测试'}).status_code, 403)
        self.assertEqual(client.post('/api/table/A1/close', headers={'X-CSRF-Token': csrf}).status_code, 403)

    def test_non_superadmin_cannot_discover_superadmin(self) -> None:
        self.create_role('directory_reader', ['user.view', 'role.view'])
        self.create_user('102', 'directory_reader')
        client, _csrf = self.login('user-102')

        users = client.get('/api/users').get_json()['data']
        roles = client.get('/api/roles').get_json()['data']
        self.assertFalse(any(role['code'] == 'superadmin' for role in roles))
        self.assertFalse(any(any(role['code'] == 'superadmin' for role in user['roles']) for user in users))

    def test_role_in_use_can_be_deleted_with_reassignment(self) -> None:
        source = self.create_role('temporary_role', ['table.view'])
        replacement = self.create_role('replacement_role', ['table.view'])
        user = self.create_user('103', 'temporary_role')

        response = self.admin.delete(
            f"/api/roles/{source['id']}",
            headers=self.admin_headers(),
            json={'replacement_role_id': replacement['id']},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()['reassigned_user_count'], 1)

        users = self.admin.get('/api/users').get_json()['data']
        updated = next(item for item in users if item['id'] == user['id'])
        self.assertEqual([role['code'] for role in updated['roles']], ['replacement_role'])

    def test_temporary_password_cannot_bypass_forced_change(self) -> None:
        self.create_role('forced_change_role', ['table.view'])
        self.create_user('105', 'forced_change_role')
        client = app.test_client()
        login = client.post('/api/auth/login/password', json={
            'identifier': 'user-105',
            'password': 'UserPassword123',
        })
        self.assertEqual(login.status_code, 200)
        blocked = client.get('/api/table/list')
        self.assertEqual(blocked.status_code, 428)
        self.assertEqual(blocked.get_json()['code'], 'PASSWORD_CHANGE_REQUIRED')

    def test_clean_user_can_be_deleted(self) -> None:
        self.create_role('deletable_role', ['table.view'])
        user = self.create_user('104', 'deletable_role')
        response = self.admin.delete(
            f"/api/users/{user['id']}",
            headers=self.admin_headers(),
        )
        self.assertEqual(response.status_code, 200, response.get_json())

    def test_unpaid_table_cannot_be_cleared(self) -> None:
        tables = [{'id': 'A1', 'status': 'occupied', 'order_id': 'O1', 'guests': 2}]
        orders = [{'id': 'O1', 'table_id': 'A1', 'status': 'submitted', 'items': []}]
        with patch('routes.table.load_tables', return_value=tables), \
                patch('routes.table.load_orders', return_value=orders), \
                patch('routes.table.save_tables') as save_tables:
            response = self.admin.post('/api/table/A1/close', headers=self.admin_headers())
        self.assertEqual(response.status_code, 409)
        save_tables.assert_not_called()

    def test_order_item_uses_server_menu_name_and_price(self) -> None:
        orders: list[dict] = []
        menu = {'categories': [{'name': '测试', 'items': [{
            'id': 1,
            'name': '服务端菜名',
            'price': 88,
            'sale_status': 'on_sale',
        }]}]}
        tables = [{'id': 'A1', 'status': 'occupied', 'guests': 2}]
        with patch('routes.order.load_menu', return_value=menu), \
                patch('routes.order.load_orders', return_value=orders), \
                patch('routes.order.load_tables', return_value=tables), \
                patch('routes.order.save_orders'), \
                patch('routes.order.update_table_status'):
            response = self.admin.post('/api/order/A1/item', headers=self.admin_headers(), json={
                'item_id': 1,
                'name': '被篡改菜名',
                'price': 0.01,
                'quantity': 1,
            })
        self.assertEqual(response.status_code, 200, response.get_json())
        item = response.get_json()['data']['items'][0]
        self.assertEqual(item['name'], '服务端菜名')
        self.assertEqual(item['price'], 88.0)


if __name__ == '__main__':
    unittest.main()
