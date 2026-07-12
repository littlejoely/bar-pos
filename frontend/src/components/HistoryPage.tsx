import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Drawer, Dropdown, Input, Modal, Select, Space, Table as AntTable, Tag, message } from 'antd'
import { DownloadOutlined, DownOutlined, MailOutlined } from '@ant-design/icons'
import zhCN from 'antd/es/date-picker/locale/zh_CN'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import 'dayjs/locale/zh-cn'
import axios from 'axios'
import OrderDetailBody, { type OrderHistory } from './OrderDetailBody'

dayjs.extend(isBetween)
dayjs.locale('zh-cn')

const { RangePicker } = DatePicker

interface Props {}

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '已支付', value: 'paid' },
  { label: '进行中', value: 'active' },
  { label: '已取消', value: 'canceled' },
  { label: '已并台', value: 'merged' },
]

const METHOD_OPTIONS = [
  { label: '全部付款方式', value: 'all' },
  { label: '微信支付', value: '微信支付' },
  { label: '支付宝', value: '支付宝' },
  { label: '现金', value: '现金' },
  { label: '银行卡', value: '银行卡' },
  { label: '挂账', value: '挂账' },
  { label: '组合支付', value: '组合支付' },
  { label: '优惠券', value: '优惠券' },
  { label: '其他', value: '其他' },
]

const money = (v: number) => (v || 0).toFixed(2)

const voucherIncomeOf = (order: OrderHistory) => {
  if (order.checkout?.voucher_income_amount != null) return order.checkout.voucher_income_amount
  const face = order.voucher?.amount || 0
  const calculated = (order.voucher?.items || []).reduce((sum, item) => (
    sum + (item.sale_price ?? item.face_value ?? 0) * (item.quantity || 0)
  ), 0)
  return calculated || face
}

const voucherDiscountOf = (order: OrderHistory) => {
  if (order.checkout?.voucher_discount_amount != null) return order.checkout.voucher_discount_amount
  return Math.max(0, (order.voucher?.amount || 0) - voucherIncomeOf(order))
}

const paidTotalOf = (order: OrderHistory) => {
  const voucherIncome = voucherIncomeOf(order)
  if ((order.payments || []).length > 0 || voucherIncome > 0) {
    return (order.payments || []).reduce((sum, payment) => sum + payment.amount, voucherIncome)
  }
  return order.paid_amount ?? (order.status === 'paid' ? order.total : 0) ?? 0
}

const refundedTotalOf = (order: OrderHistory) =>
  (order.refunds || []).reduce((sum, refund) => sum + refund.amount, 0)

const refundableTotalOf = (order: OrderHistory) =>
  Math.max(0, paidTotalOf(order) - refundedTotalOf(order))

const orderTimestamp = (order: OrderHistory) =>
  order.paid_at || order.canceled_at || order.merged_at || order.created_at

const orderEndTime = (order: OrderHistory) =>
  order.cleared_at || order.canceled_at || order.merged_at || '—'

const orderDiscountAmount = (order: OrderHistory) => {
  const activeItems = (order.items || []).filter(item => !item.returned)
  const original = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const subtotal = order.total || 0
  const orderDiscount = subtotal * ((order.order_discount || 0) / 100)
  const voucherDiscount = voucherDiscountOf(order)
  const finalPayable = Math.max(
    0,
    subtotal - orderDiscount - (order.order_reduction || 0) - voucherDiscount - (order.round_down || 0)
  )
  return Math.max(0, original - finalPayable)
}

const comparisonText = (current: number, baseline: number) => {
  if (baseline === 0) return current === 0 ? '0.0%' : '—'
  const value = ((current - baseline) / baseline) * 100
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

const ComparisonLine = ({ current, previous, yearAgo }: {
  current: number
  previous: number
  yearAgo: number
}) => (
  <span className="stat-comparison">
    <em className={current >= previous ? 'up' : 'down'}>环比 {comparisonText(current, previous)}</em>
    <em className={current >= yearAgo ? 'up' : 'down'}>同比 {comparisonText(current, yearAgo)}</em>
  </span>
)

function HistoryPage({}: Props = {}) {
  const [orders, setOrders] = useState<OrderHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('day'),
    dayjs().endOf('day'),
  ])
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [methodFilter, setMethodFilter] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const [detailOrder, setDetailOrder] = useState<OrderHistory | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [shopName, setShopName] = useState('SILVER LINING')
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundAmountEditing, setRefundAmountEditing] = useState(false)
  const [refundAmount, setRefundAmount] = useState('0.00')
  const [refundReason, setRefundReason] = useState('')
  const [replaceRefundAmountOnInput, setReplaceRefundAmountOnInput] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [emailExportOpen, setEmailExportOpen] = useState(false)
  const [exportEmail, setExportEmail] = useState('')
  const [exporting, setExporting] = useState(false)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [tableBodyHeight, setTableBodyHeight] = useState(320)

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/order/list')
      if (res.data.success) {
        setOrders(res.data.data)
      } else {
        message.error(res.data.error || '获取订单失败')
      }
    } catch (e) {
      message.error('获取订单失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
    axios.get('/api/shop').then(res => {
      if (res.data.success && res.data.data?.name) setShopName(res.data.data.name)
    }).catch(() => undefined)
  }, [])

  useLayoutEffect(() => {
    const element = tableWrapRef.current
    if (!element) return
    const updateHeight = () => {
      setTableBodyHeight(Math.max(160, element.clientHeight - 126))
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const printOrderDetail = () => {
    const source = document.querySelector<HTMLElement>('.order-print-sheet')
    if (!source) {
      message.error('打印内容尚未准备完成')
      return
    }
    const printable = source.cloneNode(true) as HTMLElement
    const printTimeNode = printable.querySelector<HTMLElement>('[data-print-time]')
    if (printTimeNode) {
      printTimeNode.textContent = `打印时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`
    }
    const styles = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(node => node.outerHTML)
      .join('')
    const frame = document.createElement('iframe')
    frame.setAttribute('title', '订单详情打印')
    Object.assign(frame.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '210mm',
      height: '297mm',
      border: '0',
      opacity: '0',
    })
    document.body.appendChild(frame)
    const printWindow = frame.contentWindow
    const printDocument = frame.contentDocument
    if (!printWindow || !printDocument) {
      frame.remove()
      message.error('无法创建打印页面')
      return
    }
    let printStarted = false
    const startPrint = () => {
      if (printStarted) return
      printStarted = true
      window.setTimeout(() => {
        printWindow.focus()
        printWindow.print()
      }, 100)
    }
    frame.onload = startPrint
    printWindow.onafterprint = () => frame.remove()
    printDocument.open()
    printDocument.write(`<!doctype html><html><head><meta charset="UTF-8"><title>订单详情</title>${styles}<style>body *{visibility:visible!important}.order-print-sheet{display:block!important;position:static!important;inset:auto!important}</style></head><body>${printable.outerHTML}</body></html>`)
    printDocument.close()
    window.setTimeout(startPrint, 800)
  }

  const openRefund = () => {
    if (!detailOrder) return
    const refundable = refundableTotalOf(detailOrder)
    if (refundable <= 0.005) {
      message.warning('本单已无可退款金额')
      return
    }
    setRefundAmount(refundable.toFixed(2))
    setRefundReason('')
    setReplaceRefundAmountOnInput(false)
    setRefundAmountEditing(false)
    setRefundOpen(true)
  }

  const pressRefundAmountKey = (key: string) => {
    if (replaceRefundAmountOnInput && key !== 'backspace' && key !== 'clear') {
      setReplaceRefundAmountOnInput(false)
      setRefundAmount(key === '.' ? '0.' : key)
      return
    }
    setReplaceRefundAmountOnInput(false)
    setRefundAmount(current => {
      if (key === 'backspace') return current.slice(0, -1)
      if (key === 'clear') return ''
      if (key === '.' && current.includes('.')) return current
      const next = `${current}${key}`
      if (!/^\d*(\.\d{0,2})?$/.test(next)) return current
      return next
    })
  }

  const confirmRefundAmount = () => {
    if (!detailOrder) return
    const amount = Number(refundAmount) || 0
    const refundable = refundableTotalOf(detailOrder)
    if (amount <= 0) {
      message.warning('退款金额必须大于 0')
      return
    }
    if (amount > refundable + 0.001) {
      message.warning(`最多可退款 ¥${money(refundable)}`)
      return
    }
    setRefundAmount(amount.toFixed(2))
    setRefundAmountEditing(false)
  }

  const submitRefund = async () => {
    if (!detailOrder || refunding) return
    if (!refundReason.trim()) {
      message.warning('请填写退款原因')
      return
    }
    setRefunding(true)
    try {
      const res = await axios.post(`/api/order/history/${encodeURIComponent(detailOrder.id)}/refund`, {
        amount: Number(refundAmount) || 0,
        reason: refundReason.trim(),
      })
      if (!res.data.success) {
        message.error(res.data.error || '退款失败')
        return
      }
      const updated = res.data.data as OrderHistory
      setDetailOrder(updated)
      setOrders(current => current.map(order => order.id === updated.id ? updated : order))
      setRefundOpen(false)
      message.success('退款已记录')
    } catch (error: any) {
      message.error(error?.response?.data?.error || '退款失败')
    } finally {
      setRefunding(false)
    }
  }

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

  const exportToLocal = async () => {
    if (!filtered.length) {
      message.warning('当前筛选结果没有可导出的订单')
      return
    }
    setExporting(true)
    try {
      const res = await axios.post('/api/order/export', {
        order_ids: filtered.map(order => order.id),
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `订单历史-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      message.success(`已导出 ${filtered.length} 笔订单`)
    } catch (error: any) {
      message.error(error?.response?.data?.error || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const exportToEmail = async () => {
    if (!/^\S+@\S+\.\S+$/.test(exportEmail.trim())) {
      message.warning('请输入正确的收件邮箱')
      return
    }
    if (!filtered.length) {
      message.warning('当前筛选结果没有可导出的订单')
      return
    }
    setExporting(true)
    try {
      const res = await axios.post('/api/order/export/email', {
        order_ids: filtered.map(order => order.id),
        email: exportEmail.trim(),
      })
      if (!res.data.success) throw new Error(res.data.error || '发送失败')
      message.success(`Excel 已发送至 ${exportEmail.trim()}`)
      setEmailExportOpen(false)
    } catch (error: any) {
      message.error(error?.response?.data?.error || error?.message || '邮件发送失败')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [dateRange, statusFilter, methodFilter, keyword, orders])

  const matchesNonDateFilters = (order: OrderHistory) => {
    if (statusFilter === 'paid' && order.status !== 'paid') return false
    if (statusFilter === 'active' && !['pending', 'submitted', 'served'].includes(order.status)) return false
    if (statusFilter === 'canceled' && order.status !== 'canceled') return false
    if (statusFilter === 'merged' && order.status !== 'merged') return false
    if (methodFilter !== 'all' && methodFilter !== order.payment_method) return false
    const value = keyword.trim().toLowerCase()
    if (value && !`${order.id} ${order.table_id}`.toLowerCase().includes(value)) return false
    return true
  }

  const filtered = useMemo(() => {
    const [start, end] = dateRange
    return orders.filter(o => {
      const d = dayjs(orderTimestamp(o))
      if (!d.isValid()) return false
      if (!d.isBetween(start, end, null, '[]')) return false
      return matchesNonDateFilters(o)
    })
  }, [orders, dateRange, statusFilter, methodFilter, keyword])

  const stats = useMemo(() => {
    const calculate = (source: OrderHistory[]) => {
      const paid = source.filter(order => order.status === 'paid')
      const revenue = paid.reduce((sum, order) => sum + refundableTotalOf(order), 0)
      const paidCount = paid.length
      const unpaid = source.filter(order => ['pending', 'submitted', 'served'].includes(order.status))
      const paymentMethods: Record<'微信' | '支付宝' | '现金', number> = {
        微信: 0,
        支付宝: 0,
        现金: 0,
      }
      paid.forEach(order => {
        const grossPaid = paidTotalOf(order)
        const netRatio = grossPaid > 0 ? refundableTotalOf(order) / grossPaid : 0
        if ((order.payments || []).length > 0) {
          order.payments?.forEach(payment => {
            const method = payment.method === '微信支付' ? '微信' : payment.method
            if (method === '微信' || method === '支付宝' || method === '现金') {
              paymentMethods[method] += payment.amount * netRatio
            }
          })
        } else {
          const method = order.payment_method === '微信支付' ? '微信' : order.payment_method
          if (method === '微信' || method === '支付宝' || method === '现金') {
            paymentMethods[method] += refundableTotalOf(order)
          }
        }
      })
      return {
        revenue,
        orderCount: source.length,
        paidCount,
        avg: paidCount > 0 ? revenue / paidCount : 0,
        discount: paid.reduce((sum, order) => sum + orderDiscountAmount(order), 0),
        unpaidCount: unpaid.length,
        unpaidAmount: unpaid.reduce((sum, order) => sum + (order.total ?? 0), 0),
        paymentMethods,
      }
    }

    const [start, end] = dateRange
    const duration = end.valueOf() - start.valueOf()
    const previousEnd = start.subtract(1, 'millisecond')
    const previousStart = previousEnd.subtract(duration, 'millisecond')
    const yearStart = start.subtract(1, 'year')
    const yearEnd = end.subtract(1, 'year')
    const inRange = (rangeStart: Dayjs, rangeEnd: Dayjs) => orders.filter(order => {
      const timestamp = dayjs(orderTimestamp(order))
      return timestamp.isValid() && timestamp.isBetween(rangeStart, rangeEnd, null, '[]') && matchesNonDateFilters(order)
    })

    return {
      current: calculate(filtered),
      previous: calculate(inRange(previousStart, previousEnd)),
      yearAgo: calculate(inRange(yearStart, yearEnd)),
    }
  }, [filtered, orders, dateRange, statusFilter, methodFilter, keyword])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pagedOrders = useMemo(
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

  const columns: ColumnsType<OrderHistory> = [
    {
      title: '序号',
      key: 'sequence',
      width: 60,
      align: 'center',
      render: (_value, _record, index) => (page - 1) * pageSize + index + 1,
    },
    { title: '订单号', dataIndex: 'id', key: 'id', width: 200 },
    { title: '桌台', dataIndex: 'table_id', key: 'table_id', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => {
        const m: Record<string, { label: string; color: string }> = {
          pending: { label: '待下单', color: 'gold' },
          submitted: { label: '已下单', color: 'blue' },
          served: { label: '已上菜', color: 'blue' },
          paid: { label: '已支付', color: 'green' },
          canceled: { label: '已取消', color: 'red' },
          merged: { label: '已并台', color: 'purple' },
        }
        const v = m[s] || { label: s, color: 'default' }
        return <Tag color={v.color}>{v.label}</Tag>
      },
    },
    {
      title: '应收',
      dataIndex: 'total',
      key: 'total',
      width: 100,
      render: (v: number) => `¥${money(v)}`,
    },
    {
      title: '实收',
      dataIndex: 'paid_amount',
      key: 'paid_amount',
      width: 100,
      render: (_v: number, r: OrderHistory) => r.status === 'paid' ? `¥${money(refundableTotalOf(r))}` : '—',
    },
    {
      title: '付款方式',
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 110,
      render: (v?: string, r?: OrderHistory) => {
        if (v) return <Tag color="blue">{v}</Tag>
        if (r?.status === 'paid') return <span style={{ color: '#595959' }}>未记录</span>
        return <span style={{ color: '#bfbfbf' }}>—</span>
      },
    },
    {
      title: '下单时间',
      key: 'submitted_at',
      width: 170,
      render: (_, order) => order.submitted_at || order.created_at,
    },
    {
      title: '结束时间',
      key: 'ended_at',
      width: 170,
      render: (_, order) => orderEndTime(order),
    },
  ]

  return (
    <div className="history-page">
      <div className="history-toolbar">
        <RangePicker
          locale={zhCN}
          value={dateRange as any}
          open={datePickerOpen}
          onOpenChange={setDatePickerOpen}
          onChange={(range) => {
            if (range && range[0] && range[1]) {
              setDateRange([
                (range[0] as Dayjs).startOf('day'),
                (range[1] as Dayjs).endOf('day'),
              ])
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
          options={STATUS_OPTIONS}
          style={{ width: 140 }}
        />
        <Select
          value={methodFilter}
          onChange={setMethodFilter}
          options={METHOD_OPTIONS}
          style={{ width: 150 }}
        />
        <Input.Search
          placeholder="搜索订单号 / 桌台号"
          allowClear
          onSearch={setKeyword}
          style={{ width: 240 }}
        />
        <Dropdown
          menu={{
            items: [
              { key: 'local', icon: <DownloadOutlined />, label: '导出到本地' },
              { key: 'email', icon: <MailOutlined />, label: '发送到邮箱' },
            ],
            onClick: ({ key }) => {
              if (key === 'local') exportToLocal()
              if (key === 'email') setEmailExportOpen(true)
            },
          }}
          trigger={['click']}
        >
          <Button className="history-export-button" loading={exporting} icon={<DownloadOutlined />}>
            <span>导出数据</span><DownOutlined className="history-export-arrow" />
          </Button>
        </Dropdown>
      </div>

      <div className="history-stats">
        <div className="history-stat-card">
          <div className="stat-card-head">
            <span className="stat-label">营业额</span>
            <span className="stat-tag">已支付</span>
          </div>
          <span className="stat-value">¥{money(stats.current.revenue)}</span>
          <ComparisonLine current={stats.current.revenue} previous={stats.previous.revenue} yearAgo={stats.yearAgo.revenue} />
        </div>

        <div className="history-stat-card">
          <div className="stat-card-head">
            <span className="stat-label">订单数</span>
            <span className="stat-tag">已结 {stats.current.paidCount}</span>
          </div>
          <span className="stat-value">{stats.current.orderCount}</span>
          <ComparisonLine current={stats.current.orderCount} previous={stats.previous.orderCount} yearAgo={stats.yearAgo.orderCount} />
        </div>

        <div className="history-stat-card">
          <div className="stat-card-head">
            <span className="stat-label">客单价</span>
            <span className="stat-tag">已支付均值</span>
          </div>
          <span className="stat-value">¥{money(stats.current.avg)}</span>
          <ComparisonLine current={stats.current.avg} previous={stats.previous.avg} yearAgo={stats.yearAgo.avg} />
        </div>

        <div className="history-stat-card">
          <div className="stat-card-head">
            <span className="stat-label">优惠金额</span>
            <span className="stat-tag">已支付订单</span>
          </div>
          <span className="stat-value">¥{money(stats.current.discount)}</span>
          <ComparisonLine current={stats.current.discount} previous={stats.previous.discount} yearAgo={stats.yearAgo.discount} />
        </div>

        <div className="history-stat-card payment-stat-card">
          <div className="stat-card-head">
            <span className="stat-label">付款方式</span>
            <span className="stat-tag">
              ¥{money(Object.values(stats.current.paymentMethods).reduce((sum, amount) => sum + amount, 0))}
            </span>
          </div>
          <div className="stat-method-list">
            {Object.entries(stats.current.paymentMethods).map(([method, amount]) => {
                const paymentTotal = Object.values(stats.current.paymentMethods).reduce((sum, value) => sum + value, 0)
                const percentage = paymentTotal > 0 ? (amount / paymentTotal) * 100 : 0
                return (
                  <div key={method} className="stat-method-row">
                    <span className="stat-method-name">{method}</span>
                    <span className="stat-method-bar">
                      <span className="stat-method-bar-fill" style={{ width: `${Math.min(100, percentage)}%` }} />
                    </span>
                    <span className="stat-method-amt">
                      ¥{money(amount)} <i className="stat-method-separator">｜</i> {percentage.toFixed(1)}%
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      <div className="history-table-wrap" ref={tableWrapRef}>
        <AntTable
          className="pos-table"
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={pagedOrders}
          scroll={{ x: 1090, y: tableBodyHeight }}
          pagination={false}
          onRow={(record) => ({
            onClick: () => setDetailOrder(record),
            style: { cursor: 'pointer' },
          })}
        />
        <div className="history-pagination-footer">
          <span className="table-record-total">共 <b>{filtered.length}</b> 条记录</span>
          <div className="history-pagination-controls">
            <button
              type="button"
              className="history-page-arrow"
              disabled={page <= 1}
              onClick={() => setPage(current => Math.max(1, current - 1))}
              aria-label="上一页"
            >‹</button>
            <div className="history-page-number-slots">
              {visiblePageItems.map(item => typeof item === 'number' ? (
                <button
                  key={item}
                  type="button"
                  className={page === item ? 'active' : ''}
                  onClick={() => setPage(item)}
                >{item}</button>
              ) : <span key={item}>•••</span>)}
            </div>
            <button
              type="button"
              className="history-page-arrow"
              disabled={page >= totalPages}
              onClick={() => setPage(current => Math.min(totalPages, current + 1))}
              aria-label="下一页"
            >›</button>
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
        title={detailOrder ? `订单详情 · ${detailOrder.id}` : ''}
        width={820}
        closeIcon={<span className="history-detail-back">←</span>}
        rootClassName="history-detail-drawer"
        extra={detailOrder && (
          <Space size={8}>
            <Button
              danger
              className="history-refund-btn"
              disabled={detailOrder.status !== 'paid' || refundableTotalOf(detailOrder) <= 0.005}
              onClick={openRefund}
            >退款</Button>
            <Button type="primary" onClick={printOrderDetail}>打印</Button>
          </Space>
        )}
        open={detailOrder !== null}
        onClose={() => setDetailOrder(null)}
      >
        {detailOrder && <OrderDetailBody order={detailOrder} />}
      </Drawer>

      <Modal
        title="发送订单 Excel"
        open={emailExportOpen}
        onCancel={() => setEmailExportOpen(false)}
        onOk={exportToEmail}
        okText="发送"
        cancelText="取消"
        confirmLoading={exporting}
        width={440}
      >
        <div className="history-email-export">
          <label>收件邮箱</label>
          <Input
            value={exportEmail}
            onChange={event => setExportEmail(event.target.value)}
            onPressEnter={exportToEmail}
            placeholder="name@example.com"
            autoFocus
          />
          <p>邮件由服务器配置的发件邮箱发送，当前筛选结果共 {filtered.length} 笔订单。</p>
        </div>
      </Modal>

      {detailOrder && (
        <div className="order-print-sheet">
          <header>
            <h1>{shopName}</h1>
            <h2>订单详情</h2>
            <div><span>订单号：{detailOrder.id}</span><span data-print-time>打印时间：—</span></div>
          </header>
          <OrderDetailBody order={detailOrder} />
        </div>
      )}

      <Modal
        title="退款"
        open={refundOpen && !refundAmountEditing}
        onCancel={() => setRefundOpen(false)}
        okText="确认退款"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: refunding }}
        onOk={submitRefund}
        width={440}
        destroyOnClose
      >
        <div className="refund-modal-body">
          <div className="payment-modal-amount refund-modal-amount">
            <strong>¥{money(Number(refundAmount) || 0)}</strong>
            <button type="button" onClick={() => {
              setReplaceRefundAmountOnInput(true)
              setRefundAmountEditing(true)
            }}>修改金额</button>
          </div>
          <label className="refund-reason-field">
            <span>退款原因</span>
            <Input.TextArea
              value={refundReason}
              onChange={event => setRefundReason(event.target.value)}
              placeholder="请填写退款原因"
              maxLength={100}
              showCount
              autoSize={{ minRows: 3, maxRows: 5 }}
            />
          </label>
        </div>
      </Modal>

      <Modal
        title="修改金额"
        open={refundOpen && refundAmountEditing}
        onCancel={() => setRefundAmountEditing(false)}
        footer={null}
        width={440}
        destroyOnClose
      >
        <div className="discount-form payment-amount-editor">
          <div className="discount-input-row">
            <div className="discount-input-wrap has-prefix">
              <span className="discount-input-prefix">¥</span>
              <input
                className={`discount-input${replaceRefundAmountOnInput ? ' amount-selection-active' : ''}`}
                type="text"
                inputMode="decimal"
                value={refundAmount}
                onChange={event => {
                  const raw = event.target.value.replace(/[^\d.]/g, '')
                  if (/^\d*(\.\d{0,2})?$/.test(raw)) {
                    setReplaceRefundAmountOnInput(false)
                    setRefundAmount(raw)
                  }
                }}
                onFocus={event => event.currentTarget.select()}
                autoFocus
              />
              {replaceRefundAmountOnInput && refundAmount && (
                <span className="payment-amount-selection-preview" aria-hidden="true">{refundAmount}</span>
              )}
            </div>
          </div>
          <div className="discount-keypad payment-keypad">
            {['1', '2', '3'].map(key => <button key={key} type="button" className="discount-key" onClick={() => pressRefundAmountKey(key)}>{key}</button>)}
            <button type="button" className="discount-key aux payment-keypad-backspace" onClick={() => pressRefundAmountKey('backspace')} aria-label="退格">
              <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true"><path d="M9 2H25V18H9L2 10L9 2Z" /><path d="M13 7L19 13M19 7L13 13" /></svg>
            </button>
            {['4', '5', '6'].map(key => <button key={key} type="button" className="discount-key" onClick={() => pressRefundAmountKey(key)}>{key}</button>)}
            <button type="button" className="discount-key aux payment-keypad-clear" onClick={() => pressRefundAmountKey('clear')}>清空</button>
            {['7', '8', '9'].map(key => <button key={key} type="button" className="discount-key" onClick={() => pressRefundAmountKey(key)}>{key}</button>)}
            <button type="button" className="discount-key payment-keypad-confirm" onClick={confirmRefundAmount}>确认</button>
            <button type="button" className="discount-key" onClick={() => pressRefundAmountKey('.')}>.</button>
            <button type="button" className="discount-key" onClick={() => pressRefundAmountKey('0')}>0</button>
            <button type="button" className="discount-key" onClick={() => pressRefundAmountKey('00')}>00</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default HistoryPage
