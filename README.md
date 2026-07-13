# Silver Lining POS

一个面向单门店酒吧和轻餐饮场景的 Web POS 原型，覆盖桌台、点单、加菜、优惠、组合支付、制作单、订单历史、退款、数据导出和基础资料管理。

> 当前版本已具备登录、用户、角色、细粒度 RBAC、服务端会话、CSRF 防护和系统日志。业务数据仍采用 JSON 单实例存储；公网运营前仍需配置 HTTPS、备份、监控，并完成正式安全验收。

## 功能概览

- 桌台区域筛选、开台、改人数、转台、并台、结清和清台；
- 首轮点单、多轮加菜、临时加菜恢复、菜品与整单备注；
- 退菜、赠菜、菜品折扣、菜品减免、整单折扣、免单和抹零；
- 微信、支付宝、现金与优惠券组合支付及收款撤销；
- 优惠券面值、实际收入和优惠金额拆分；
- 制作单生成、划菜、超时提醒、完成归档、历史查询和导出；
- 订单历史、同环比指标、支付方式统计、订单详情、打印和部分退款；
- 类别、商品、区域、桌台、优惠券和制作单开关管理；
- 商品筛选、排序、在售/下架、批量修改和 Excel 导出；
- 订单、制作单和商品 Excel 导出；
- 账号密码与短账号/短密码登录、快速切换账号、锁屏和会话下线；
- 超级管理员初始化、用户生命周期、自定义角色和细粒度业务权限；
- Argon2id 凭据哈希、登录锁定、CSRF 防护、真实操作人及系统审计日志；
- 全系统金额固定两位小数，关键操作保留细颗粒度日志。

完整业务规则见 [产品需求文档](docs/PRD.md)。

## 当前边界

- 扫码支付为人工登记渠道，没有对接微信或支付宝官方支付接口；
- 退款为系统登记，没有调用支付渠道原路退款；
- 数据保存在 JSON 文件中，只适合单实例、小规模运行；
- 直接运行 `backend/app.py` 时使用 Flask 开发服务器；生产部署使用 Gunicorn；
- 邮件导出需要自行配置 SMTP，默认不启用；
- 已建立认证、越权、超级管理员隔离、角色改派和用户删除的后端回归测试；金额及完整营业流程仍需继续扩充自动化覆盖。

## 技术栈

### 前端

- React 18.3.1
- TypeScript 5.9.3
- Ant Design 5.29.3
- Vite 5.4.21
- Axios 1.17.0

### 后端

- Python 3.9.6
- Flask 3.1.3
- flask-cors 6.0.5
- Gunicorn 23.0.0
- openpyxl 3.1.5
- SQLAlchemy 2.0.51
- argon2-cffi 25.1.0
- JSON 业务数据 + SQLite 认证数据

完整依赖和版本策略见 [依赖与环境基线](docs/DEPENDENCIES.md)。

## 快速开始

### 1. 克隆项目

```bash
git clone <your-repository-url>
cd pos-bar
```

### 2. 创建后端环境

```bash
python3.9 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r backend/requirements.lock
```

### 3. 安装前端依赖

```bash
cd frontend
npm ci
cd ..
```

### 4. 启动开发环境

```bash
chmod +x dev.sh
./dev.sh start
```

访问地址：

- 前端：`http://localhost:27778`
- 后端健康检查：`http://localhost:27779/api/health`

首次访问时系统会进入初始化页，需要现场创建首位超级管理员的登录账号、密码、短账号和短密码；项目不提供默认管理员凭证。

默认启用作品集访客账号，登录页会以浅灰色文字展示公开账号与密码。访客可以浏览全部非超级管理员信息，新增商品、类别、区域、桌台、优惠券、用户和角色，并体验开台、订单、收款和制作单流程；访客只能继续操作本人创建的数据，系统既有数据及其他用户创建的数据保持只读。访客创建的新用户也会继承相同的数据范围，不能借此绕过隔离。可通过 `POS_DEMO_GUEST_ENABLED=false` 关闭，或使用环境变量替换公开凭证。

常用命令：

```bash
./dev.sh status
./dev.sh logs
./dev.sh restart
./dev.sh stop
```

也可以分别启动：

```bash
.venv/bin/python backend/app.py

cd frontend
npm run dev
```

## 生产构建

```bash
cd frontend
npm ci
npm run build
cd ..
```

构建产物位于 `frontend/dist`。Flask 可从该目录提供静态文件：

```bash
.venv/bin/python backend/app.py
```

仓库提供 Silver Lining 单服务器部署脚本。服务器需预先安装 Python、`python3-venv`、Nginx，并允许部署账号使用 `sudo`：

```bash
SERVER=deploy@example.com ./deploy.sh
```

脚本默认部署到 `/srv/silverlining/pos-bar`，以独立 `silverlining` 用户运行 Gunicorn，通过 systemd 管理，并仅由 Nginx 对外提供服务。默认保留服务器运行数据；首次初始化或明确需要覆盖数据时使用：

```bash
SERVER=deploy@example.com DEPLOY_DATA=true ./deploy.sh
```

正式公网运营仍需补充：

- HTTPS，并设置 `POS_COOKIE_SECURE=true`；
- 自动备份、恢复演练、日志轮转和监控；
- PostgreSQL/事务型存储或单进程写入约束；
- 多进程部署时使用 Redis/网关实现共享限流；
- 渗透测试与权限矩阵验收。

## 项目结构

```text
pos-bar/
├── backend/
│   ├── app.py                 # Flask 入口
│   ├── requirements.txt       # 直接依赖
│   ├── requirements.lock      # 完整 Python 锁定依赖
│   ├── auth/                  # 登录、会话、角色与权限模型
│   ├── instance/              # 本地认证数据库（不提交）
│   ├── data/                  # 运行数据
│   ├── routes/                # API 路由
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   └── src/
├── docs/
│   ├── PRD.md
│   └── DEPENDENCIES.md
├── deploy/                   # systemd 与 Nginx 生产配置
├── dev.sh
└── deploy.sh
```

## 数据文件

| 文件 | 内容 |
|---|---|
| `backend/data/menu.json` | 店名、分类和商品 |
| `backend/data/tables.json` | 区域、桌台和桌台状态 |
| `backend/data/orders.json` | 订单、支付、退款、制作单和操作日志 |
| `backend/data/vouchers.json` | 优惠券定义 |
| `backend/data/system_settings.json` | 制作单功能开关 |
| `backend/instance/auth.db` | 用户、角色、权限、会话和审计数据（SQLite，不提交） |

提交或部署前请确认这些数据是否适合公开。运行时备份目录 `backend/data/backups/` 已加入 `.gitignore`。

## 可选 SMTP 配置

订单邮件导出需要以下环境变量：

```bash
export SMTP_HOST=smtp.example.com
export SMTP_PORT=465
export SMTP_USER=your-account
export SMTP_PASSWORD=your-app-password
export SMTP_FROM=your-account@example.com
export SMTP_SSL=true
```

不要把真实凭据写入代码、README、`.env` 示例值或提交历史。

## 开发与贡献

提交改动前至少执行：

```bash
cd frontend
npm ci
npm run build

cd ..
.venv/bin/python -m pip check
.venv/bin/python -m unittest discover -s backend/tests -v
.venv/bin/python -m compileall -q backend
git diff --check
```

建议 Pull Request 包含：

- 修改背景和用户价值；
- 主要交互或 API 变更；
- 金额、订单状态和数据兼容影响；
- 验证步骤和结果；
- 涉及界面时附截图或录屏；
- 依赖变更时同时更新锁文件和 `docs/DEPENDENCIES.md`。

## 路线图

近期重点：

1. 退款、免单、撤销收款等敏感操作的短时单次授权；
2. 订单金额与完整营业闭环自动化回归测试；
3. JSON 业务数据迁移至 PostgreSQL；
4. 生产 HTTPS、备份恢复、监控告警和安全验收；
5. 真实支付渠道、硬件打印及支付对账。

## 开源协议

本项目采用 [Apache License 2.0](LICENSE) 开源。你可以在遵守许可证条款的前提下使用、修改和分发本项目。

## 安全问题

安全问题请按 [安全策略](SECURITY.md) 通过仓库的私密漏洞报告渠道提交，不要在公开 Issue 中披露凭据或可利用细节。
