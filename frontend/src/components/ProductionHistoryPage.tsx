import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Drawer, Input, Select, Table as AntTable, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import 'dayjs/locale/zh-cn'
import zhCN from 'antd/es/date-picker/locale/zh_CN'
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import axios from 'axios'

dayjs.extend(isBetween)
dayjs.locale('zh-cn')

const { RangePicker } = DatePicker

interface ProductionHistoryItem {
  id: number
  name: string
  quantity: number
  completed?: boolean
  completed_at?: string
  remark?: string
}

interface ProductionHistoryTicket {
  id: string
  order_id: string
  table_id: string
  type: string
  created_at: string
  archived: boolean
  archived_at?: string
  items: ProductionHistoryItem[]
  order_remark?: string
}

export default function ProductionHistoryPage() {
  const [tickets, setTickets] = useState<ProductionHistoryTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('day'),
    dayjs().endOf('day'),
  ])
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [tableBodyHeight, setTableBodyHeight] = useState(320)
  const [detailTicket, setDetailTicket] = useState<ProductionHistoryTicket | null>(null)
  const [clock, setClock] = useState(Date.now())
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setLoading(true)
    axios.get('/api/order/tickets/history')
      .then(res => {
        if (res.data.success) setTickets(res.data.data)
        else message.error(res.data.error || '获取制作单记录失败')
      })
      .catch(() => message.error('获取制作单记录失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      message.success(`${label}已复制`)
    } catch {
      const input = document.createElement('textarea')
      input.value = value
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
      message.success(`${label}已复制`)
    }
  }

  const productionDuration = (ticket: ProductionHistoryTicket) => {
    const startedAt = new Date(ticket.created_at.replace(' ', 'T')).getTime()
    const endedAt = ticket.archived_at
      ? new Date(ticket.archived_at.replace(' ', 'T')).getTime()
      : clock
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return '—'
    const totalSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const productionIsOverdue = (ticket: ProductionHistoryTicket) => {
    const startedAt = new Date(ticket.created_at.replace(' ', 'T')).getTime()
    const endedAt = ticket.archived_at ? new Date(ticket.archived_at.replace(' ', 'T')).getTime() : clock
    return Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt - startedAt > 10 * 60 * 1000
  }

  useLayoutEffect(() => {
    const element = tableWrapRef.current
    if (!element) return
    const updateHeight = () => setTableBodyHeight(Math.max(160, element.clientHeight - 126))
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [dateRange, statusFilter, typeFilter, keyword])

  const typeOptions = useMemo(() => [
    { label: '全部类型', value: 'all' },
    ...Array.from(new Set(tickets.map(ticket => ticket.type).filter(Boolean)))
      .map(type => ({ label: type, value: type })),
  ], [tickets])

  const filtered = useMemo(() => {
    const value = keyword.trim().toLowerCase()
    const [start, end] = dateRange
    return tickets.filter(ticket => {
      const createdAt = dayjs(ticket.created_at)
      if (!createdAt.isValid() || !createdAt.isBetween(start, end, null, '[]')) return false
      if (statusFilter === 'active' && ticket.archived) return false
      if (statusFilter === 'archived' && !ticket.archived) return false
      if (typeFilter !== 'all' && ticket.type !== typeFilter) return false
      if (value && !`${ticket.id} ${ticket.order_id} ${ticket.table_id} ${ticket.type}`.toLowerCase().includes(value)) return false
      return true
    })
  }, [tickets, keyword, dateRange, statusFilter, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pagedTickets = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  )
  const visiblePageItems = useMemo<Array<number | string>>(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
    if (page <= 3) return [1, 2, 3, 'more-right', totalPages]
    if (page >= totalPages - 2) return [1, 'more-left', totalPages - 2, totalPages - 1, totalPages]
    return [1, 'more-left', page, 'more-right', totalPages]
  }, [page, totalPages])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const applyDatePreset = (type: 'today' | 'yesterday' | 'week' | 'month') => {
    const today = dayjs()
    const ranges: Record<typeof type, [Dayjs, Dayjs]> = {
      today: [today.startOf('day'), today.endOf('day')],
      yesterday: [today.subtract(1, 'day').startOf('day'), today.subtract(1, 'day').endOf('day')],
      week: [today.subtract(6, 'day').startOf('day'), today.endOf('day')],
      month: [today.subtract(29, 'day').startOf('day'), today.endOf('day')],
    }
    setDateRange(ranges[type])
    setDatePickerOpen(false)
  }

  const exportTickets = async () => {
    if (!filtered.length) {
      message.warning('当前筛选结果没有可导出的制作单')
      return
    }
    setExporting(true)
    try {
      const res = await axios.post('/api/order/tickets/export', {
        ticket_ids: filtered.map(ticket => ticket.id),
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `制作单记录-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      message.success(`已导出 ${filtered.length} 张制作单`)
    } catch (error: any) {
      message.error(error?.response?.data?.error || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const columns: ColumnsType<ProductionHistoryTicket> = [
    {
      title: '序号',
      key: 'sequence',
      width: 60,
      align: 'center',
      render: (_value, _record, index) => (page - 1) * pageSize + index + 1,
    },
    { title: '制作单号', dataIndex: 'id', key: 'id', width: 210 },
    { title: '订单号', dataIndex: 'order_id', key: 'order_id', width: 190 },
    { title: '桌台', dataIndex: 'table_id', key: 'table_id', width: 75 },
    { title: '类型', dataIndex: 'type', key: 'type', width: 90 },
    {
      title: '订单备注',
      dataIndex: 'order_remark',
      key: 'order_remark',
      width: 150,
      render: (value?: string) => value || '—',
    },
    {
      title: '进度',
      key: 'progress',
      width: 90,
      render: (_, ticket) => {
        const completed = ticket.items.filter(item => item.completed).length
        return `${completed}/${ticket.items.length}`
      },
    },
    {
      title: '状态',
      dataIndex: 'archived',
      key: 'archived',
      width: 90,
      render: (archived: boolean) => archived
        ? <Tag color="green">已完成</Tag>
        : <Tag color="gold">制作中</Tag>,
    },
    { title: '下单时间', dataIndex: 'created_at', key: 'created_at', width: 165 },
    {
      title: '完成时间',
      dataIndex: 'archived_at',
      key: 'archived_at',
      width: 165,
      render: (value?: string) => value || '—',
    },
  ]

  return (
    <div className="production-history-page">
      <div className="history-toolbar production-history-filterbar">
        <RangePicker
          locale={zhCN}
          value={dateRange as any}
          open={datePickerOpen}
          onOpenChange={setDatePickerOpen}
          onChange={range => {
            if (range && range[0] && range[1]) {
              setDateRange([(range[0] as Dayjs).startOf('day'), (range[1] as Dayjs).endOf('day')])
            }
          }}
          format="YYYY-MM-DD"
          allowClear={false}
          panelRender={panelNode => (
            <div className="history-date-panel">
              <div className="history-date-presets">
                <button type="button" onClick={() => applyDatePreset('today')}>今日</button>
                <button type="button" onClick={() => applyDatePreset('yesterday')}>昨日</button>
                <button type="button" onClick={() => applyDatePreset('week')}>近7天</button>
                <button type="button" onClick={() => applyDatePreset('month')}>近30天</button>
              </div>
              {panelNode}
            </div>
          )}
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 130 }}
          options={[
            { label: '全部状态', value: 'all' },
            { label: '制作中', value: 'active' },
            { label: '已完成', value: 'archived' },
          ]}
        />
        <Select value={typeFilter} onChange={setTypeFilter} style={{ width: 130 }} options={typeOptions} />
        <Input.Search
          value={keyword}
          placeholder="搜索制作单号 / 订单号 / 桌台"
          allowClear
          onChange={event => setKeyword(event.target.value)}
          style={{ width: 280 }}
        />
        <Button
          className="history-export-button"
          loading={exporting}
          icon={<DownloadOutlined />}
          onClick={exportTickets}
        >导出数据</Button>
      </div>

      <div className="history-table-wrap production-history-table" ref={tableWrapRef}>
        <AntTable
          className="pos-table production-history-pos-table"
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={pagedTickets}
          scroll={{ x: 1285, y: tableBodyHeight }}
          pagination={false}
          onRow={ticket => ({
            onClick: () => setDetailTicket(ticket),
            style: { cursor: 'pointer' },
          })}
        />
        <div className="history-pagination-footer">
          <span className="table-record-total">共 <b>{filtered.length}</b> 张制作单</span>
          <div className="history-pagination-controls">
            <button type="button" className="history-page-arrow" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>‹</button>
            <div className="history-page-number-slots">
              {visiblePageItems.map(item => typeof item === 'number' ? (
                <button key={item} type="button" className={page === item ? 'active' : ''} onClick={() => setPage(item)}>{item}</button>
              ) : <span key={item}>•••</span>)}
            </div>
            <button type="button" className="history-page-arrow" disabled={page >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>›</button>
            <Select
              className="history-page-size-selector"
              value={pageSize}
              showSearch={false}
              popupMatchSelectWidth={false}
              options={[10, 20, 50, 100].map(size => ({ value: size, label: `${size} 条/页` }))}
              onChange={size => {
                setPageSize(size)
                setPage(1)
              }}
            />
          </div>
        </div>
      </div>

      <Drawer
        title={detailTicket ? `制作单详情 · ${detailTicket.id}` : ''}
        width={720}
        closeIcon={<span className="history-detail-back">←</span>}
        rootClassName="history-detail-drawer production-detail-drawer"
        open={detailTicket !== null}
        onClose={() => setDetailTicket(null)}
      >
        {detailTicket && (
          <div className="production-ticket-detail">
            <section className="production-detail-card">
              <div className="production-detail-meta">
                <div>
                  <span>制作单号</span>
                  <span className="production-copy-value"><b>{detailTicket.id}</b><button type="button" onClick={() => copyText(detailTicket.id, '制作单号')} aria-label="复制制作单号"><CopyOutlined /></button></span>
                </div>
                <div>
                  <span>订单号</span>
                  <span className="production-copy-value"><b>{detailTicket.order_id}</b><button type="button" onClick={() => copyText(detailTicket.order_id, '订单号')} aria-label="复制订单号"><CopyOutlined /></button></span>
                </div>
                <div><span>桌台</span><b>{detailTicket.table_id}</b></div>
                <div><span>类型</span><b>{detailTicket.type}</b></div>
                <div><span>状态</span>{detailTicket.archived ? <Tag color="green">已完成</Tag> : <Tag color="gold">制作中</Tag>}</div>
                <div><span>制作时长</span><b className={`production-duration-value${productionIsOverdue(detailTicket) ? ' overdue' : ''}`}>{productionDuration(detailTicket)}</b></div>
                <div><span>下单时间</span><b>{detailTicket.created_at || '—'}</b></div>
                <div><span>完成时间</span><b>{detailTicket.archived_at || '—'}</b></div>
              </div>
            </section>

            {detailTicket.order_remark && (
              <section className="production-detail-card production-detail-remark">
                <span>整单备注</span>
                <p>{detailTicket.order_remark}</p>
              </section>
            )}

            <section className="production-detail-card">
              <div className="production-detail-title">
                <span>菜品明细</span>
                <b>{detailTicket.items.filter(item => item.completed).length}/{detailTicket.items.length} 已完成</b>
              </div>
              <div className="production-detail-items">
                {detailTicket.items.length > 0 ? detailTicket.items.map((item, index) => (
                  <div key={`${detailTicket.id}-${item.id}-${index}`} className={item.completed ? 'completed' : ''}>
                    <span className="production-detail-item-name">
                      <b>{item.name}</b>
                      {item.remark && <em>（{item.remark}）</em>}
                    </span>
                    <strong>×{item.quantity}</strong>
                    {item.completed ? <Tag color="green">已完成</Tag> : <Tag color="gold">待出品</Tag>}
                    <time>{item.completed_at || '—'}</time>
                  </div>
                )) : <div className="order-detail-empty">暂无菜品记录</div>}
              </div>
            </section>
          </div>
        )}
      </Drawer>
    </div>
  )
}
