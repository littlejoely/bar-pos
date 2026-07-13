import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Avatar, ConfigProvider, Dropdown, Spin, message } from 'antd'
import { LockOutlined, LogoutOutlined, SwapOutlined, UserOutlined } from '@ant-design/icons'
import axios from 'axios'
import zhCN from 'antd/locale/zh_CN'
import TableOverview from './components/TableOverview'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { LoginPage } from './components/LoginPage'
import { LockScreen } from './components/LockScreen'
import { CredentialChangePage } from './components/CredentialChangePage'
import AccountSwitcher from './components/AccountSwitcher'

const OrderPage = lazy(() => import('./components/OrderPage'))
const HistoryPage = lazy(() => import('./components/HistoryPage'))
const SettingsPage = lazy(() => import('./components/SettingsPage'))
const ProductionHistoryPage = lazy(() => import('./components/ProductionHistoryPage'))

type ViewName = 'tables' | 'order' | 'history' | 'production-history' | 'settings'

interface View {
  name: ViewName
  tableId?: string
}

type PendingTableAction =
  | { kind: 'transfer'; sourceTableId: string }
  | { kind: 'merge'; sourceTableId: string }
  | null

function PosWorkspace() {
  const { user, defaultView, hasPermission, lock, logout } = useAuth()
  const initialView = ['tables', 'history', 'production-history', 'settings'].includes(defaultView)
    ? defaultView as ViewName
    : 'tables'
  const [view, setView] = useState<View>({ name: initialView })
  const [pendingAction, setPendingAction] = useState<PendingTableAction>(null)
  const [productionTicketEnabled, setProductionTicketEnabled] = useState(false)
  const [systemSettingsLoaded, setSystemSettingsLoaded] = useState(false)
  const navTabsRef = useRef<HTMLDivElement>(null)
  const navTabRefs = useRef(new Map<ViewName, HTMLButtonElement>())
  const [navIndicator, setNavIndicator] = useState({ left: 0, width: 0, ready: false })
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  useEffect(() => {
    axios.get('/api/system-settings')
      .then(res => {
        if (res.data.success) {
          setProductionTicketEnabled(res.data.data.production_ticket_enabled !== false)
        }
      })
      .catch(() => undefined)
      .finally(() => setSystemSettingsLoaded(true))
  }, [])

  useEffect(() => {
    if (systemSettingsLoaded && !productionTicketEnabled && view.name === 'production-history') {
      setView({ name: 'tables' })
    }
  }, [productionTicketEnabled, systemSettingsLoaded, view.name])

  const handleSelectTable = (tableId: string) => {
    setView({ name: 'order', tableId })
  }

  const handleBack = () => {
    setView({ name: 'tables' })
  }

  const requestTableAction = (kind: 'transfer' | 'merge', sourceTableId: string) => {
    setPendingAction({ kind, sourceTableId })
    setView({ name: 'tables' })
  }

  const cancelTableAction = () => {
    setPendingAction(null)
  }

  const confirmTableAction = async (targetTableId: string) => {
    if (!pendingAction) return
    const { kind, sourceTableId } = pendingAction
    try {
      const endpoint = kind === 'transfer' ? 'transfer' : 'merge'
      const res = await axios.post(`/api/order/${sourceTableId}/${endpoint}`, {
        target_table_id: targetTableId,
      })
      if (res.data.success) {
        setPendingAction(null)
        setView({ name: 'order', tableId: targetTableId })
      } else {
        message.error(res.data.error || '操作失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败')
    }
  }

  const navTabs: { key: ViewName; label: string }[] = [
    ...(hasPermission('table.view') ? [{ key: 'tables' as ViewName, label: '桌台' }] : []),
    ...(hasPermission('history.view') ? [{ key: 'history' as ViewName, label: '订单历史' }] : []),
    ...(productionTicketEnabled && hasPermission('ticket.history')
      ? [{ key: 'production-history' as ViewName, label: '制作单记录' }]
      : []),
    ...(Array.from([
      'menu.view', 'table_config.view', 'voucher.view', 'system.production_ticket',
      'user.view', 'role.view',
      'audit.view',
    ]).some(hasPermission) ? [{ key: 'settings' as ViewName, label: '设置' }] : []),
  ]
  const activeNavKey: ViewName = view.name === 'order' ? 'tables' : view.name

  useLayoutEffect(() => {
    const container = navTabsRef.current
    const activeTab = navTabRefs.current.get(activeNavKey)
    if (!container || !activeTab) return

    const updateIndicator = () => {
      setNavIndicator({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
        ready: true,
      })
    }
    updateIndicator()

    const observer = new ResizeObserver(updateIndicator)
    observer.observe(container)
    observer.observe(activeTab)
    return () => observer.disconnect()
  }, [activeNavKey, productionTicketEnabled])

  useEffect(() => {
    const currentKey = view.name === 'order' ? 'tables' : view.name
    if (navTabs.length && !navTabs.some(tab => tab.key === currentKey)) {
      setView({ name: navTabs[0].key })
    }
  }, [view.name, navTabs.map(tab => tab.key).join('|')])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#4f46e5',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#cf5d3e',
          colorInfo: '#4f46e5',
          colorTextBase: '#1f1f1f',
          colorBgBase: '#ffffff',
          borderRadius: 8,
          fontSize: 14,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif",
        },
        components: {
          Button: {
            controlHeight: 40,
            fontWeight: 600,
          },
          Card: {
            borderRadiusLG: 8,
          },
          Table: {
            headerBg: '#fafafa',
            headerColor: '#1f1f1f',
            headerSortActiveBg: '#eef2ff',
            rowHoverBg: '#f5f5f5',
          },
          Tabs: {
            titleFontSize: 15,
            horizontalItemPadding: '12px 20px',
          },
        },
      }}
    >
      <div className="app-shell">
        <header className="top-nav">
          <div className="top-nav-brand">
            <span className="brand-mark">SL</span>
            <span>Silver Lining POS</span>
          </div>
          <div className="top-nav-tabs" ref={navTabsRef}>
            <span
              aria-hidden="true"
              className={`top-nav-indicator${navIndicator.ready ? ' ready' : ''}`}
              style={{ left: navIndicator.left, width: navIndicator.width }}
            />
            {navTabs.map(tab => {
              const active = view.name === tab.key || (tab.key === 'tables' && view.name === 'order')
              return (
                <button
                  key={tab.key}
                  ref={element => {
                    if (element) navTabRefs.current.set(tab.key, element)
                    else navTabRefs.current.delete(tab.key)
                  }}
                  type="button"
                  className={`top-nav-tab${active ? ' active' : ''}`}
                  onClick={() => setView({ name: tab.key })}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          <div className="top-nav-right">
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'identity', disabled: true, label: `${user?.display_name} · ${user?.roles.map(role => role.name).join(' / ')}` },
                  { type: 'divider' },
                  { key: 'switch', icon: <SwapOutlined />, label: '切换账号', onClick: () => setAccountSwitcherOpen(true) },
                  { key: 'lock', icon: <LockOutlined />, label: '锁定屏幕', onClick: () => lock() },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: () => logout() },
                ],
              }}
            >
              <button type="button" className="top-nav-user">
                <Avatar size={30} icon={<UserOutlined />}>{user?.display_name?.slice(0, 1)}</Avatar>
                <span>{user?.display_name}</span>
              </button>
            </Dropdown>
          </div>
        </header>

        <div className="page-shell">
          <Suspense fallback={<div className="auth-loading"><Spin size="large" /><span>正在加载页面…</span></div>}>
          {navTabs.length === 0 && (
            <div className="auth-loading">
              <span>{systemSettingsLoaded
                ? '当前账号暂无可访问模块，或其默认业务模块尚未开启，请联系管理员调整权限。'
                : '正在加载系统配置…'}</span>
            </div>
          )}
          {navTabs.length > 0 && <>
          {view.name === 'tables' && (
            <TableOverview
              onSelectTable={handleSelectTable}
              pendingAction={pendingAction}
              onCancelAction={cancelTableAction}
              onConfirmAction={confirmTableAction}
              productionTicketEnabled={productionTicketEnabled}
            />
          )}
          {view.name === 'order' && view.tableId && (
            <OrderPage
              tableId={view.tableId}
              onBack={handleBack}
              onRequestTableAction={requestTableAction}
              productionTicketEnabled={productionTicketEnabled}
            />
          )}
          {view.name === 'history' && <HistoryPage />}
          {view.name === 'production-history' && <ProductionHistoryPage />}
          {view.name === 'settings' && (
            <SettingsPage onProductionTicketEnabledChange={setProductionTicketEnabled} />
          )}
          </>}
          </Suspense>
        </div>
        <AccountSwitcher open={accountSwitcherOpen} onClose={() => setAccountSwitcherOpen(false)} />
      </div>
    </ConfigProvider>
  )
}

function AuthGate() {
  const { stage, user } = useAuth()
  if (stage === 'loading') {
    return <div className="auth-loading"><Spin size="large" /><span>正在检查登录状态…</span></div>
  }
  if (stage === 'bootstrap' || stage === 'login') return <LoginPage />
  if (stage === 'locked') return <LockScreen />
  if (stage === 'credential-change') return <CredentialChangePage />
  return <PosWorkspace key={user?.id} />
}

function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

export default App
