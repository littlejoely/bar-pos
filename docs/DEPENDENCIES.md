# Silver Lining POS 依赖与环境基线

本文档记录 2026-07-13 已验证环境、锁文件用途、安装方式和依赖升级规则。部署时应优先使用锁文件，而不是重新解析宽松版本。

## 1. 已验证运行环境

| 层级 | 已验证版本 | 版本文件 |
|---|---:|---|
| 操作系统 | macOS（开发环境） | — |
| Python | 3.9.6 | `/.python-version` |
| pip | 21.2.4 | 随当前虚拟环境 |
| Node.js | 25.8.1 | `/frontend/.nvmrc` |
| npm | 11.11.0 | `/frontend/package.json#engines` |
| 前端开发端口 | 27778 | `/frontend/vite.config.ts` |
| 后端服务端口 | 27779 | `/backend/app.py` |

> Node.js 25 不是长期支持版。本文件忠实记录当前已验证环境。正式长期部署时可另行验证 Node.js 22 LTS；验证通过前不要擅自改变锁定版本。

## 2. 锁文件说明

### 2.1 前端

- `frontend/package.json`：直接依赖全部使用精确版本，不使用 `^` 或 `~`。
- `frontend/package-lock.json`：npm lockfile v3，锁定全部直接与传递依赖及完整性哈希。
- `frontend/.nvmrc`：锁定已验证 Node.js 版本。

生产或 CI 安装必须使用：

```bash
cd frontend
npm ci
npm run build
```

不要在部署环境使用 `npm install`，因为它允许重新解析依赖树并可能改写锁文件。

### 2.2 后端

- `backend/requirements.txt`：仅列出项目直接依赖，并锁定版本。
- `backend/requirements.lock`：列出当前已验证环境中的全部直接和传递依赖。
- `.python-version`：锁定已验证 Python 版本。

严格复现环境使用：

```bash
python3.9 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r backend/requirements.lock
```

日常开发如只关心直接依赖，可使用 `backend/requirements.txt`；生产部署和 CI 应使用 `backend/requirements.lock`。

## 3. 前端直接依赖

| 包 | 版本 | 用途 |
|---|---:|---|
| react | 18.3.1 | UI 组件与状态管理 |
| react-dom | 18.3.1 | 浏览器渲染 |
| antd | 5.29.3 | 表格、表单、弹窗、抽屉、标签等基础组件 |
| @ant-design/icons | 5.6.1 | 图标库 |
| axios | 1.17.0 | HTTP API 请求 |
| typescript | 5.9.3 | TypeScript 编译与类型检查 |
| vite | 5.4.21 | 开发服务器与生产构建 |
| @vitejs/plugin-react | 4.7.0 | Vite React 转换插件 |
| @types/react | 18.3.31 | React 类型定义 |
| @types/react-dom | 18.3.7 | React DOM 类型定义 |

## 4. 后端直接依赖

| 包 | 版本 | 用途 |
|---|---:|---|
| Flask | 3.1.3 | HTTP 服务、路由、静态文件托管 |
| flask-cors | 6.0.5 | 开发环境跨域支持 |
| openpyxl | 3.1.5 | 商品、订单、制作单 Excel 导入或导出 |

邮件发送使用 Python 标准库 `smtplib` 和 `email`，不需要额外 pip 包。

## 5. 可选运行配置

订单历史“发送到邮箱”只有在 SMTP 环境变量完整时才可用。当前业务决定暂不配置邮箱服务。

| 环境变量 | 必填条件 | 默认值 | 说明 |
|---|---|---|---|
| `SMTP_HOST` | 邮件导出启用时 | 空 | SMTP 主机 |
| `SMTP_PORT` | 邮件导出启用时 | `465` | SMTP 端口 |
| `SMTP_USER` | 视服务商要求 | 空 | 登录账号 |
| `SMTP_PASSWORD` | 视服务商要求 | 空 | 登录密码或授权码 |
| `SMTP_FROM` | 邮件导出启用时 | `SMTP_USER` | 发件地址 |
| `SMTP_SSL` | 否 | `true` | 是否使用 SMTP SSL |
| `SMTP_USE_TLS` | 非 SSL 时 | `true` | 是否执行 STARTTLS |

## 6. 本地启动

开发模式需要两个终端：

```bash
# 终端 1：后端
.venv/bin/python backend/app.py

# 终端 2：前端
cd frontend
npm run dev
```

浏览器访问 `http://localhost:27778`。Vite 会将 `/api` 代理到 `http://localhost:27779`。

## 7. 单服务部署

```bash
cd frontend
npm ci
npm run build
cd ..
.venv/bin/python backend/app.py
```

Flask 会从 `frontend/dist` 提供前端静态文件，访问 `http://服务器地址:27779`。

## 8. 数据文件与备份

运行数据位于 `backend/data`：

- `menu.json`：分类和商品；
- `tables.json`：区域、桌台和当前桌台状态；
- `orders.json`：订单、付款、退款、制作单和操作日志；
- `vouchers.json`：优惠券定义；
- `system_settings.json`：系统功能开关；
- `backups/`：菜单导入或迁移前备份。

部署前应对整个 `backend/data` 目录做快照。当前 JSON 存储适合单实例、小规模使用，不支持多个后端进程并发写入。

## 9. 依赖升级规范

1. 在独立分支修改直接依赖版本。
2. 前端执行 `npm install` 更新 `package-lock.json`，随后执行 `npm ci && npm run build`。
3. 后端在干净虚拟环境安装直接依赖并运行验证，再用 `python -m pip freeze`重建 `requirements.lock`。
4. 检查订单计算、Excel 导出、中文日期组件和打印样式。
5. 同步更新本文档的环境基线和变更日期。
6. 不允许只改 `package.json` 或 `requirements.txt` 而不更新对应锁文件。
