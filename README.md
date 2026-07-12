# Silver Lining POS

一个面向单门店酒吧和轻餐饮场景的 Web POS 原型，覆盖桌台、点单、加菜、优惠、组合支付、制作单、订单历史、退款、数据导出和基础资料管理。

> 当前项目适合本地、内网、产品验证和二次开发。登录与用户权限仍处于下一阶段规划中，请勿在未增加鉴权、HTTPS 和生产级部署配置前直接暴露到不可信公网。

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
- 全系统金额固定两位小数，关键操作保留细颗粒度日志。

完整业务规则见 [产品需求文档](docs/PRD.md)。

## 当前边界

- 没有登录、用户权限和真实操作人隔离；相关方案已写入 PRD 下一阶段计划；
- 扫码支付为人工登记渠道，没有对接微信或支付宝官方支付接口；
- 退款为系统登记，没有调用支付渠道原路退款；
- 数据保存在 JSON 文件中，只适合单实例、小规模运行；
- 直接运行 `backend/app.py` 时使用 Flask 开发服务器；生产部署使用 Gunicorn；
- 邮件导出需要自行配置 SMTP，默认不启用；
- 暂无自动化测试套件，合并重要改动前至少执行构建和核心流程回归。

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
- JSON 文件存储

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

- 登录和后端 API 鉴权；
- HTTPS；
- 自动备份、恢复演练、日志轮转和监控；
- 限制 CORS、CSRF 防护、速率限制和安全响应头。

## 项目结构

```text
pos-bar/
├── backend/
│   ├── app.py                 # Flask 入口
│   ├── requirements.txt       # 直接依赖
│   ├── requirements.lock      # 完整 Python 锁定依赖
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
.venv/bin/python -m py_compile backend/app.py backend/routes/*.py
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

1. 账号密码与员工号 + PIN 登录；
2. 超级管理员、店长、收银员、服务员、出品人员 RBAC；
3. 退款、免单、撤销收款等敏感操作授权；
4. 真实操作人审计；
5. 用户、权限、会话数据迁移至 SQLite/PostgreSQL；
6. 生产 WSGI、HTTPS、备份和安全加固。

## 开源协议

本项目采用 [Apache License 2.0](LICENSE) 开源。你可以在遵守许可证条款的前提下使用、修改和分发本项目。

## 安全问题

当前未设置专用安全邮箱。公开仓库后建议增加 `SECURITY.md`，要求安全漏洞通过私密渠道报告，不要直接公开 Issue。
