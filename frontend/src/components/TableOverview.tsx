import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Space, message } from 'antd'
import {
  ClockCircleOutlined,
  PrinterOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import { formatAmount } from '../utils/money'

type DisplayStatus = 'empty' | 'opened' | 'pending_checkout' | 'settled' | 'pending_cleanup'

interface DiningTable {
  id: string
  area: string
  status: string
  display_status: DisplayStatus
  guests: number
  opened_at: string | null
  order_id: string | null
  active_order_id?: string | null
  order_total?: number
  item_count?: number
  default_guests?: number
}

interface TicketItem {
  id: number
  name: string
  quantity: number
  completed?: boolean
  completed_at?: string
  remark?: string
}

interface ProductionTicket {
  id: string
  type: string
  table_id: string
  guests: number
  created_at: string
  items: TicketItem[]
  order_remark?: string
}

interface Stats {
  total_amount: number
  total_count: number
  total_guests: number
  unpaid_amount: number
  unpaid_count: number
  unpaid_guests: number
}

interface Props {
  onSelectTable: (tableId: string) => void
  pendingAction?: { kind: 'transfer' | 'merge'; sourceTableId: string } | null
  onCancelAction?: () => void
  onConfirmAction?: (targetTableId: string) => void
  productionTicketEnabled: boolean
}

const statusMeta: Record<DisplayStatus, { label: string; tone: string; action: string }> = {
  empty: { label: '空桌', tone: 'empty', action: '开台' },
  opened: { label: '待下单', tone: 'opened', action: '点单' },
  pending_checkout: { label: '待结账', tone: 'checkout', action: '结账' },
  settled: { label: '已结清', tone: 'cleanup', action: '清台' },
  pending_cleanup: { label: '已结清', tone: 'cleanup', action: '清台' },
}

const getDefaultGuests = (table: DiningTable) => table.default_guests ?? 1

function TableOverview({ onSelectTable, pendingAction, onCancelAction, onConfirmAction, productionTicketEnabled }: Props) {
  const [tables, setTables] = useState<DiningTable[]>([])
  const [areas, setAreas] = useState<string[]>(['全部'])
  const [selectedArea, setSelectedArea] = useState('全部')
  const [openModalVisible, setOpenModalVisible] = useState(false)
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [guestInput, setGuestInput] = useState<number | null>(1)
  const [guestInputDirty, setGuestInputDirty] = useState(false)
  const [remarkInput, setRemarkInput] = useState('')
  const [stats, setStats] = useState<Stats>({
    total_amount: 0,
    total_count: 0,
    total_guests: 0,
    unpaid_amount: 0,
    unpaid_count: 0,
    unpaid_guests: 0,
  })
  const [tickets, setTickets] = useState<ProductionTicket[]>([])
  const ticketItemRefs = useRef(new Map<string, HTMLDivElement>())
  const previousTicketItemPositions = useRef(new Map<string, DOMRect>())
  const delayedTicketSortState = useRef(new Map<string, boolean>())
  const ticketSortTimers = useRef<number[]>([])
  const [ticketSortRevision, setTicketSortRevision] = useState(0)
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    fetchTables()
    fetchStats()
  }, [])

  useEffect(() => {
    if (productionTicketEnabled) fetchTickets()
    else setTickets([])
  }, [productionTicketEnabled])

  useLayoutEffect(() => {
    if (previousTicketItemPositions.current.size === 0) return
    ticketItemRefs.current.forEach((element, key) => {
      const previous = previousTicketItemPositions.current.get(key)
      if (!previous) return
      const current = element.getBoundingClientRect()
      const offsetY = previous.top - current.top
      if (Math.abs(offsetY) < 1) return
      element.animate(
        [
          {
            transform: `translateY(${offsetY}px)`,
          },
          {
            transform: `translateY(${offsetY * 0.68}px)`,
            offset: 0.38,
          },
          {
            transform: `translateY(${offsetY * 0.2}px)`,
            offset: 0.78,
          },
          {
            transform: 'translateY(0)',
          },
        ],
        {
          duration: 1050,
          easing: 'cubic-bezier(0.2, 0.72, 0.2, 1)',
        }
      )
    })
    previousTicketItemPositions.current.clear()
  }, [tickets, ticketSortRevision])

  useEffect(() => () => {
    ticketSortTimers.current.forEach(timer => window.clearTimeout(timer))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const fetchTables = async () => {
    try {
      const [listRes, configRes] = await Promise.all([
        axios.get('/api/table/list'),
        axios.get('/api/table/configuration'),
      ])
      if (listRes.data.success) {
        setTables(listRes.data.data)
      }
      if (configRes.data.success) {
        const areaNames = (configRes.data.data.areas || []).map((a: { name: string }) => a.name)
        setAreas(['全部', ...areaNames])
        setSelectedArea(prev => (areaNames.includes(prev) || prev === '全部' ? prev : '全部'))
      }
    } catch (e) {
      message.error('获取桌台列表失败')
    }
  }

  const fetchStats = async () => {
    try {
      const res = await axios.get('/api/order/stats')
      if (res.data.success) {
        setStats(res.data.data)
      }
    } catch (e) {
      message.error('获取统计失败')
    }
  }

  const fetchTickets = async () => {
    try {
      const res = await axios.get('/api/order/tickets')
      if (res.data.success) {
        setTickets(res.data.data)
      }
    } catch (e) {
      message.error('获取小票失败')
    }
  }

  const filteredTables = useMemo(() => {
    return tables.filter(table => {
      return selectedArea === '全部' || table.area === selectedArea
    })
  }, [selectedArea, tables])

  const getOpenMinutes = (openedAt: string | null) => {
    if (!openedAt) return 0
    const opened = new Date(openedAt.replace(' ', 'T')).getTime()
    if (!Number.isFinite(opened)) return 0
    return Math.max(0, Math.floor((clock - opened) / 60_000))
  }

  const archiveTicket = async (ticket: ProductionTicket) => {
    try {
      const res = await axios.post(`/api/order/${ticket.table_id}/ticket/${ticket.id}/archive`)
      if (res.data.success) {
        fetchTickets()
      } else {
        message.error(res.data.error || '归档失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '归档失败')
    }
  }

  const updateTicketItems = async (
    ticket: ProductionTicket,
    payload: { item_index?: number; completed: boolean; all?: boolean }
  ) => {
    try {
      const res = await axios.patch(
        `/api/order/${ticket.table_id}/ticket/${ticket.id}/items`,
        payload
      )
      if (res.data.success) {
        const nextItems = res.data.data.items as TicketItem[]
        const changedKeys: string[] = []
        nextItems.forEach((item, index) => {
          const previousCompleted = Boolean(ticket.items[index]?.completed)
          if (previousCompleted !== Boolean(item.completed)) {
            const key = `${ticket.id}-${index}`
            delayedTicketSortState.current.set(key, previousCompleted)
            changedKeys.push(key)
          }
        })
        setTickets(current => current.map(item => item.id === ticket.id
          ? { ...item, items: nextItems }
          : item))
        if (changedKeys.length > 0) {
          const timer = window.setTimeout(() => {
            const positions = new Map<string, DOMRect>()
            ticketItemRefs.current.forEach((element, key) => {
              positions.set(key, element.getBoundingClientRect())
            })
            previousTicketItemPositions.current = positions
            changedKeys.forEach(key => delayedTicketSortState.current.delete(key))
            setTicketSortRevision(revision => revision + 1)
          }, 320)
          ticketSortTimers.current.push(timer)
        }
      } else {
        message.error(res.data.error || '更新制作单失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新制作单失败')
    }
  }

  const getProductionDuration = (createdAt: string) => {
    const started = new Date(createdAt?.replace(' ', 'T')).getTime()
    if (!Number.isFinite(started)) return '00:00'
    const totalSeconds = Math.max(0, Math.floor((clock - started) / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const isProductionOverdue = (createdAt: string) => {
    const started = new Date(createdAt?.replace(' ', 'T')).getTime()
    return Number.isFinite(started) && clock - started > 10 * 60 * 1000
  }

  const handleTableClick = (table: DiningTable) => {
    if (pendingAction) {
      if (table.id === pendingAction.sourceTableId) return
      if (pendingAction.kind === 'transfer' && table.display_status !== 'empty') return
      if (pendingAction.kind === 'merge' && table.display_status !== 'opened' && table.display_status !== 'pending_checkout') return
      onConfirmAction?.(table.id)
      return
    }

    if (table.display_status === 'empty') {
      setSelectedTableId(table.id)
      setGuestInput(getDefaultGuests(table))
      setGuestInputDirty(false)
      setRemarkInput('')
      setOpenModalVisible(true)
      return
    }

    if (table.display_status === 'pending_cleanup') {
      Modal.confirm({
        title: `清台 ${table.id}`,
        content: '确认该桌已经完成清理？清台后桌台会恢复为空桌。',
        okText: '确认清台',
        cancelText: '返回',
        onOk: async () => {
          try {
            const res = await axios.post(`/api/table/${table.id}/close`)
            if (res.data.success) {
              fetchTables()
              fetchStats()
            } else {
              message.error(res.data.error || '清台失败')
            }
          } catch (e) {
            message.error('清台失败')
          }
        },
      })
      return
    }

    onSelectTable(table.id)
  }

  const handleOpenTable = async () => {
    if (!selectedTableId) return

    const guests = guestInput
    if (guests == null || !Number.isInteger(guests) || guests < 1 || guests > 50) {
      message.error('请输入 1-50 的用餐人数')
      return
    }

    try {
      const res = await axios.post(`/api/table/${selectedTableId}/open`, {
        guests,
        remark: remarkInput.trim(),
      })
      if (res.data.success) {
        setOpenModalVisible(false)
        onSelectTable(selectedTableId)
      } else {
        message.error(res.data.error || '开台失败')
      }
    } catch (e) {
      message.error('开台失败')
    }
  }

  const pressKeypad = (key: string) => {
    setGuestInput(current => {
      const cur = current == null ? 0 : current
      if (key === 'backspace') {
        return cur >= 10 ? Math.floor(cur / 10) : 0
      }
      if (key === 'clear') {
        return 0
      }
      const digit = Number(key)
      if (Number.isNaN(digit)) return current
      if (!guestInputDirty) {
        return digit
      }
      const next = cur * 10 + digit
      return next > 50 ? cur : next
    })
    setGuestInputDirty(true)
  }

  return (
    <main className="pos-page">
      {pendingAction && (
        <div className="table-action-banner">
          <div className="table-action-banner-info">
            <strong>
              {pendingAction.kind === 'transfer'
                ? `转台模式 · 从 ${pendingAction.sourceTableId} 转到`
                : `并台模式 · 将 ${pendingAction.sourceTableId} 并入`}
            </strong>
            <span>
              {pendingAction.kind === 'transfer'
                ? '请点击目标空桌完成转台'
                : '请点击目标在用桌台完成并台'}
            </span>
          </div>
          <button type="button" className="table-action-cancel" onClick={onCancelAction}>
            取消
          </button>
        </div>
      )}
      <section className="filter-bar">
        <div className="filter-left">
          <Space wrap>
            {areas.map(area => (
              <Button
                key={area}
                className={selectedArea === area ? 'segmented-btn active' : 'segmented-btn'}
                onClick={() => setSelectedArea(area)}
              >
                {area}
              </Button>
            ))}
          </Space>
        </div>
        <div className="filter-right">
          <div className="metric-pill">
            <span className="metric-label">未结账</span>
            <span className="metric-info">{stats.unpaid_count} 桌 · {stats.unpaid_guests} 人</span>
            <b className="metric-amount">¥{formatAmount(stats.unpaid_amount)}</b>
          </div>
          <div className="metric-pill">
            <span className="metric-label">今日营业</span>
            <span className="metric-info">{stats.total_count} 笔 · {stats.total_guests} 人</span>
            <b className="metric-amount">¥{formatAmount(stats.total_amount)}</b>
          </div>
        </div>
      </section>

      <section className="table-grid">
        {filteredTables.map(table => {
          const meta = statusMeta[table.display_status] || statusMeta.empty
          const isDisabledForAction = (() => {
            if (!pendingAction) return false
            if (table.id === pendingAction.sourceTableId) return true
            if (pendingAction.kind === 'transfer') return table.display_status !== 'empty'
            if (pendingAction.kind === 'merge') return table.display_status !== 'opened' && table.display_status !== 'pending_checkout'
            return false
          })()
          return (
            <button
              key={table.id}
              className={`table-tile ${meta.tone}${isDisabledForAction ? ' action-disabled' : ''}`}
              onClick={() => handleTableClick(table)}
              disabled={isDisabledForAction}
            >
              {table.display_status !== 'empty' && (
                <span className="tile-status">{meta.label}</span>
              )}
              <strong>{table.id}</strong>
              {table.display_status !== 'empty' && (
                <span className="tile-amount">¥{formatAmount(table.order_total)}</span>
              )}
              <span className="tile-detail">
                {table.display_status === 'empty' ? (
                  <span><TeamOutlined /> {getDefaultGuests(table)}人</span>
                ) : (
                  <>
                    <span><TeamOutlined /> {table.guests || 0}人</span>
                    <em>·</em>
                    <span><ClockCircleOutlined /> {getOpenMinutes(table.opened_at)}分钟</span>
                  </>
                )}
              </span>
            </button>
          )
        })}
      </section>

      {productionTicketEnabled && <section className={`ticket-board${tickets.length === 0 ? ' empty' : ''}`}>
        <div className="ticket-board-head">
          <span><PrinterOutlined /> 制作单</span>
          <b>{tickets.length} 张</b>
        </div>
        <div className="ticket-strip">
          {tickets.length === 0 ? (
            <div className="empty-ticket">暂无制作单</div>
          ) : tickets.map(ticket => {
            const sortedItems = ticket.items
              .map((item, originalIndex) => {
                const delayedState = delayedTicketSortState.current.get(`${ticket.id}-${originalIndex}`)
                return {
                  ...item,
                  originalIndex,
                  sortCompleted: delayedState ?? Boolean(item.completed),
                }
              })
              .sort((a, b) => Number(a.sortCompleted) - Number(b.sortCompleted) || a.originalIndex - b.originalIndex)
            const allCompleted = ticket.items.length > 0 && ticket.items.every(item => item.completed)
            return (
            <article key={ticket.id} className="ticket-note">
              <div className="ticket-note-head">
                <div className="ticket-note-title">
                  <strong>{ticket.table_id}</strong>
                  <span className={isProductionOverdue(ticket.created_at) ? 'overdue' : ''}>
                    · {getProductionDuration(ticket.created_at)}
                  </span>
                </div>
                <time>{ticket.created_at?.slice(11, 19)}</time>
              </div>
              {ticket.order_remark && (
                <div className="ticket-order-remark" title={ticket.order_remark}>
                  订单备注：{ticket.order_remark}
                </div>
              )}
              <div className="ticket-note-lines">
                {sortedItems.map(item => (
                  <div
                    key={`${ticket.id}-${item.originalIndex}`}
                    ref={element => {
                      const key = `${ticket.id}-${item.originalIndex}`
                      if (element) ticketItemRefs.current.set(key, element)
                      else ticketItemRefs.current.delete(key)
                    }}
                    className={`ticket-line${item.completed ? ' completed' : ''}`}
                  >
                    <span className="ticket-checkbox" onClick={event => event.stopPropagation()}>
                      <input
                        id={`ticket-check-${ticket.id}-${item.originalIndex}`}
                        type="checkbox"
                        checked={Boolean(item.completed)}
                        onChange={() => updateTicketItems(ticket, {
                          item_index: item.originalIndex,
                          completed: !item.completed,
                        })}
                      />
                      <label htmlFor={`ticket-check-${ticket.id}-${item.originalIndex}`} className="check">
                        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                          <path d="M1,9 L1,3.5 C1,2 2,1 3.5,1 L14.5,1 C16,1 17,2 17,3.5 L17,14.5 C17,16 16,17 14.5,17 L3.5,17 C2,17 1,16 1,14.5 L1,9 Z" />
                          <polyline points="1 9 7 14 15 4" />
                        </svg>
                      </label>
                    </span>
                    <span className="ticket-line-name">
                      {item.name}
                      {item.remark && <em>（{item.remark}）</em>}
                    </span>
                    <b>x{item.quantity}</b>
                  </div>
                ))}
              </div>
              <div className="ticket-note-actions">
                <Button onClick={() => updateTicketItems(ticket, { all: true, completed: !allCompleted })}>
                  {allCompleted ? '取消全选' : '全选'}
                </Button>
                <Button type="primary" onClick={() => archiveTicket(ticket)}>完成</Button>
              </div>
            </article>
          )})}
        </div>
      </section>}

      <Modal
        title="开台"
        open={openModalVisible}
        onCancel={() => setOpenModalVisible(false)}
        footer={null}
        destroyOnClose
        width={620}
      >
        <div className="open-table-split">
          <div className="open-split-left">
            <div className="open-field">
              <label className="open-field-label">桌号</label>
              <div className="open-table-id">{selectedTableId || '—'}</div>
            </div>
            <div className="open-field">
              <label className="open-field-label">人数 <span className="open-required">*</span></label>
              <div className="open-guest-display">
                <span className={`open-guest-value${guestInputDirty ? '' : ' selected'}`}>
                  {guestInput ?? 0}
                </span>
              </div>
            </div>
            <div className="open-field">
              <label className="open-field-label">桌台备注（可选）</label>
              <input
                className="open-remark-input"
                type="text"
                value={remarkInput}
                onChange={e => setRemarkInput(e.target.value)}
                placeholder="如：靠窗、宝宝椅、生日布置"
                maxLength={50}
              />
            </div>
            <button
              type="button"
              className="open-confirm-btn"
              onClick={handleOpenTable}
            >
              开台
            </button>
          </div>
          <div className="open-split-right">
            <div className="open-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => (
                <button key={k} type="button" className="keypad-num" onClick={() => pressKeypad(k)}>
                  {k}
                </button>
              ))}
              <button type="button" className="keypad-aux" onClick={() => pressKeypad('clear')}>
                清空
              </button>
              <button type="button" className="keypad-num" onClick={() => pressKeypad('0')}>
                0
              </button>
              <button type="button" className="keypad-aux keypad-back" onClick={() => pressKeypad('backspace')} aria-label="退格">
                <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true">
                  <path d="M9 2H25V18H9L2 10L9 2Z" />
                  <path d="M13 7L19 13M19 7L13 13" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </main>
  )
}

export default TableOverview
