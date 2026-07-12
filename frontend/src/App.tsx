import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ConfigProvider, message } from 'antd'
import axios from 'axios'
import zhCN from 'antd/locale/zh_CN'
import TableOverview from './components/TableOverview'
import OrderPage from './components/OrderPage'
import HistoryPage from './components/HistoryPage'
import SettingsPage from './components/SettingsPage'
import ProductionHistoryPage from './components/ProductionHistoryPage'

type ViewName = 'tables' | 'order' | 'history' | 'production-history' | 'settings'

interface View {
  name: ViewName
  tableId?: string
}

type PendingTableAction =
  | { kind: 'transfer'; sourceTableId: string }
  | { kind: 'merge'; sourceTableId: string }
  | null

function App() {
  const [view, setView] = useState<View>({ name: 'tables' })
  const [pendingAction, setPendingAction] = useState<PendingTableAction>(null)
  const [productionTicketEnabled, setProductionTicketEnabled] = useState(false)
  const navTabsRef = useRef<HTMLDivElement>(null)
  const navTabRefs = useRef(new Map<ViewName, HTMLButtonElement>())
  const [navIndicator, setNavIndicator] = useState({ left: 0, width: 0, ready: false })

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
  }, [])

  useEffect(() => {
    if (!productionTicketEnabled && view.name === 'production-history') {
      setView({ name: 'tables' })
    }
  }, [productionTicketEnabled, view.name])

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
    { key: 'tables', label: '桌台' },
    { key: 'history', label: '订单历史' },
    ...(productionTicketEnabled
      ? [{ key: 'production-history' as ViewName, label: '制作单记录' }]
      : []),
    { key: 'settings', label: '设置' },
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
          <div className="top-nav-right" />
        </header>

        <div className="page-shell">
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
        </div>
      </div>
    </ConfigProvider>
  )
}

export default App
