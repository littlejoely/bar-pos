import type { FC } from 'react'
import { Tag } from 'antd'
import { formatAmount } from '../utils/money'

export interface OrderHistoryItem {
  id: number
  name: string
  price: number
  quantity: number
  remark?: string
  discount?: number
  reduction?: number
  gift_quantity?: number
  gift_reason?: string
  discount_reason?: string
  reduction_reason?: string
  returned?: boolean
  return_reason?: string
  added_at?: string
  line_total?: number
}

export interface OrderPaymentRecord {
  id: string
  method: string
  amount: number
  time: string
}

export interface OrderRefundRecord {
  id: string
  amount: number
  reason: string
  time: string
}

export interface OrderOperationLog {
  id: string
  time: string
  category: string
  action: string
  detail: string
  operator?: string
}

interface OrderVoucherItem {
  id?: number
  name?: string
  quantity?: number
  face_value?: number
  sale_price?: number
  amount?: number
}

export interface OrderHistory {
  id: string
  table_id: string
  total: number
  status: string
  created_at: string
  paid_at?: string
  cleared_at?: string
  canceled_at?: string
  submitted_at?: string
  guests?: number
  remark?: string
  items?: OrderHistoryItem[]
  payment_method?: string
  paid_amount?: number
  transferred_from?: string
  transferred_at?: string
  merged_to?: string
  merged_at?: string
  order_discount?: number
  order_reduction?: number
  voucher?: { name?: string; amount?: number; items?: OrderVoucherItem[] }
  round_down?: number
  payments?: OrderPaymentRecord[]
  refunds?: OrderRefundRecord[]
  operation_logs?: OrderOperationLog[]
  checkout?: {
    payable?: number
    paid_total?: number
    voucher_income_amount?: number
    voucher_discount_amount?: number
  }
}

export const orderStatusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '待下单', color: 'gold' },
  submitted: { label: '已下单', color: 'blue' },
  served: { label: '已上菜', color: 'blue' },
  paid: { label: '已支付', color: 'green' },
  canceled: { label: '已取消', color: 'red' },
  merged: { label: '已并台', color: 'purple' },
}

export const computeItemLineTotal = (item: OrderHistoryItem): number => {
  if (item.returned) return 0
  if (item.line_total != null) return item.line_total
  const qty = item.quantity || 0
  const giftQty = Math.min(item.gift_quantity || 0, qty)
  let line = item.price * (qty - giftQty)
  if (item.discount) line *= (1 - item.discount / 100)
  if (item.reduction) line -= item.reduction
  return Math.max(0, line)
}

const shortDateTime = (value?: string) => value ? value.replace('T', ' ').slice(2, 19) : '—'

const latestPaymentTime = (order: OrderHistory) => {
  const times = (order.payments || []).map(payment => payment.time).filter(Boolean).sort()
  return times[times.length - 1] || order.paid_at
}

const voucherFinancials = (order: OrderHistory) => {
  const face = order.voucher?.amount || 0
  const calculatedIncome = (order.voucher?.items || []).reduce((sum, item) => (
    sum + (item.sale_price ?? item.face_value ?? 0) * (item.quantity || 0)
  ), 0)
  const income = order.checkout?.voucher_income_amount ?? (calculatedIncome || face)
  const discount = order.checkout?.voucher_discount_amount ?? Math.max(0, face - income)
  return { face, income, discount }
}

const paymentMethodLabel = (order: OrderHistory) => {
  const methods = Array.from(new Set((order.payments || []).map(payment => (
    payment.method === '微信支付' ? '微信' : payment.method
  )).filter(Boolean)))
  if (voucherFinancials(order).income > 0) methods.push('优惠券')
  if (methods.length > 1) return '组合支付'
  if (methods.length === 1) return methods[0]
  if (order.payment_method === '微信支付') return '微信'
  return order.payment_method || (order.status === 'paid' ? '未记录' : '—')
}

const itemOfferBadge = (item: OrderHistoryItem) => {
  if (item.discount) {
    const remain = (100 - item.discount) / 10
    return remain === 0 ? '免费' : `${remain}折`
  }
  if (item.reduction) return `-¥${formatAmount(item.reduction)}`
  return null
}

const giftBadge = (item: OrderHistoryItem) => {
  if (!item.gift_quantity) return null
  return item.gift_quantity >= item.quantity ? '赠' : `赠${item.gift_quantity}`
}

const operationCategoryColor: Record<string, string> = {
  订单: 'blue',
  菜品: 'gold',
  优惠: 'orange',
  收款: 'green',
  退款: 'red',
  桌台: 'purple',
}

const buildOperationLogs = (order: OrderHistory): OrderOperationLog[] => {
  const legacy: OrderOperationLog[] = []
  const add = (id: string, time: string | undefined, category: string, action: string, detail: string) => {
    if (!time) return
    legacy.push({ id, time, category, action, detail, operator: '系统记录' })
  }
  add('legacy-created', order.created_at, '订单', '创建订单', `桌台 ${order.table_id}，人数 ${order.guests ?? '—'}`)
  ;(order.items || []).forEach((item, index) => {
    add(`legacy-item-${item.id}-${index}`, item.added_at, '菜品', '添加菜品', `${item.name} × ${item.quantity}，单价 ¥${item.price.toFixed(2)}`)
  })
  add('legacy-submit', order.submitted_at, '订单', '提交下单', '菜品正式提交')
  ;(order.payments || []).forEach(payment => {
    add(`legacy-payment-${payment.id}`, payment.time, '收款', '收款', `${payment.method} ¥${payment.amount.toFixed(2)}，流水 ${payment.id}`)
  })
  add('legacy-paid', order.paid_at, '订单', '完成结账', `实收 ¥${paidTotalForLog(order).toFixed(2)}`)
  ;(order.refunds || []).forEach(refund => {
    add(`legacy-refund-${refund.id}`, refund.time, '退款', '订单退款', `退款 ¥${refund.amount.toFixed(2)}，原因：${refund.reason}`)
  })
  add('legacy-cleared', order.cleared_at, '桌台', '清台', `桌台 ${order.table_id} 已恢复为空桌`)
  add('legacy-canceled', order.canceled_at, '订单', '撤销订单', '订单已取消')
  add('legacy-merged', order.merged_at, '桌台', '并台', `并台至 ${order.merged_to || '其他订单'}`)

  const recorded = order.operation_logs || []
  const filteredLegacy = legacy.filter(item => !recorded.some(log => (
    log.time === item.time && log.category === item.category
  )))
  return [...recorded, ...filteredLegacy].sort((a, b) => b.time.localeCompare(a.time))
}

const paidTotalForLog = (order: OrderHistory) => {
  const voucherIncome = voucherFinancials(order).income
  if ((order.payments || []).length > 0 || voucherIncome > 0) {
    return (order.payments || []).reduce((sum, payment) => sum + payment.amount, voucherIncome)
  }
  return order.paid_amount ?? order.total ?? 0
}

const OrderDetailBody: FC<{ order: OrderHistory }> = ({ order }) => {
  const items = order.items || []
  const activeItems = items.filter(item => !item.returned)
  const statusMeta = orderStatusLabels[order.status] || { label: order.status, color: 'default' }
  const giftCount = activeItems.reduce((sum, item) => sum + Math.min(item.gift_quantity || 0, item.quantity), 0)
  const giftAmount = activeItems.reduce((sum, item) => (
    sum + item.price * Math.min(item.gift_quantity || 0, item.quantity)
  ), 0)
  const discountItems = activeItems.filter(item => (item.discount || 0) > 0)
  const discountAmount = discountItems.reduce((sum, item) => {
    const chargedQuantity = Math.max(0, item.quantity - Math.min(item.gift_quantity || 0, item.quantity))
    return sum + item.price * chargedQuantity * ((item.discount || 0) / 100)
  }, 0)
  const reductionItems = activeItems.filter(item => (item.reduction || 0) > 0)
  const reductionAmount = reductionItems.reduce((sum, item) => sum + (item.reduction || 0), 0)
  const subtotal = order.total || 0
  const orderDiscountAmount = subtotal * ((order.order_discount || 0) / 100)
  const voucherTotals = voucherFinancials(order)
  const voucherAmount = voucherTotals.face
  const payable = order.checkout?.payable ?? Math.max(0, subtotal - orderDiscountAmount - (order.order_reduction || 0) - voucherTotals.discount - (order.round_down || 0))
  const originalTotal = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const totalSaving = Math.max(0, originalTotal - payable)
  const payments = order.payments || []
  const paidTotal = payments.length > 0 || voucherTotals.income > 0
    ? payments.reduce((sum, payment) => sum + payment.amount, voucherTotals.income)
    : (order.paid_amount ?? (order.status === 'paid' ? payable : 0))
  const refundTotal = (order.refunds || []).reduce((sum, refund) => sum + refund.amount, 0)
  const netPaidTotal = Math.max(0, paidTotal - refundTotal)
  const voucherItems = order.voucher?.items || []
  const operationLogs = buildOperationLogs(order)

  return (
    <div className="order-detail">
      <div className="order-detail-section order-detail-meta-card">
        <div className="order-detail-meta">
          <div><span className="meta-label">桌台</span><b>{order.table_id}</b></div>
          <div><span className="meta-label">人数</span><b>{order.guests ?? '—'}</b></div>
          <div><span className="meta-label">状态</span><Tag color={statusMeta.color}>{statusMeta.label}</Tag></div>
          <div><span className="meta-label">开台时间</span><span>{order.created_at || '—'}</span></div>
          <div><span className="meta-label">最后付款时间</span><span>{latestPaymentTime(order) || '—'}</span></div>
          <div><span className="meta-label">清台时间</span><span>{order.cleared_at || order.canceled_at || order.merged_at || '—'}</span></div>
        </div>
      </div>

      {order.remark && (
        <div className="bill-order-remark-card order-detail-remark-card">
          <div className="bill-order-remark-head"><span>整单备注</span></div>
          <p>{order.remark}</p>
        </div>
      )}

      <div className="order-detail-section">
        <div className="order-detail-section-title">菜品明细</div>
        <div className="order-history-bill-list">
          {items.length === 0 ? (
            <div className="order-detail-empty">无菜品</div>
          ) : items.map(item => {
            const offerBadge = itemOfferBadge(item)
            const itemGiftBadge = giftBadge(item)
            const currentTotal = computeItemLineTotal(item)
            const itemOriginalTotal = item.price * item.quantity
            const hasDiscount = currentTotal < itemOriginalTotal - 0.005
            return (
              <div key={item.id} className={`bill-item order-history-bill-item${item.returned ? ' returned locked' : ''}`}>
                <span className="bill-item-name-wrap">
                  <span className="order-history-item-main">
                    <strong className="bill-item-name">
                      {item.name}
                      {item.returned && <span className="bill-item-return-flag" title={item.return_reason}>退</span>}
                      {item.remark && <em className="bill-item-remark">（{item.remark}）</em>}
                    </strong>
                    <time>{shortDateTime(item.added_at || order.submitted_at || order.created_at)}</time>
                  </span>
                  {itemGiftBadge && <span className="bill-item-gift-flag">{itemGiftBadge}</span>}
                  {offerBadge && <span className="bill-item-flag">{offerBadge}</span>}
                </span>
                <span className="bill-item-qty">{item.quantity}</span>
                <span className="bill-item-price">
                  {item.returned ? (
                    <del className="bill-item-returned-price">¥{itemOriginalTotal.toFixed(2)}</del>
                  ) : (
                    <>
                      <b className="bill-item-total">¥{currentTotal.toFixed(2)}</b>
                      {hasDiscount && <del>¥{itemOriginalTotal.toFixed(2)}</del>}
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="order-detail-section">
        <div className="order-detail-section-title order-detail-title-with-total">
          <span>优惠汇总</span><b>优惠总额 ¥{totalSaving.toFixed(2)}</b>
        </div>
        <div className="order-detail-summary four-columns">
          <div><span>赠菜</span><b>{giftCount} 份 · ¥{giftAmount.toFixed(2)}</b></div>
          <div><span>折扣菜品</span><b>{discountItems.length} 项 · ¥{discountAmount.toFixed(2)}</b></div>
          <div><span>减免菜品</span><b>{reductionItems.length} 项 · ¥{reductionAmount.toFixed(2)}</b></div>
          <div><span>抹零</span><b>¥{(order.round_down || 0).toFixed(2)}</b></div>
        </div>
        <div className="order-summary-voucher">
          <div className="order-summary-voucher-title">
            <span>优惠券优惠</span><b>-¥{voucherTotals.discount.toFixed(2)}</b>
          </div>
          {voucherAmount > 0 ? (
            <div className="order-voucher-list">
              {voucherItems.length > 0 ? voucherItems.map((voucher, index) => (
                <div key={`${voucher.id ?? voucher.name}-${index}`}>
                  <span>{voucher.name || '优惠券'}</span>
                  <span>{voucher.quantity || 1} 张</span>
                  <b>面值 ¥{(voucher.amount ?? (voucher.face_value || 0) * (voucher.quantity || 1)).toFixed(2)} ｜ 实收 ¥{((voucher.sale_price ?? voucher.face_value ?? 0) * (voucher.quantity || 1)).toFixed(2)} ｜ 优惠 ¥{Math.max(0, ((voucher.face_value || 0) - (voucher.sale_price ?? voucher.face_value ?? 0)) * (voucher.quantity || 1)).toFixed(2)}</b>
                </div>
              )) : (
                <div><span>{order.voucher?.name || '优惠券'}</span><span>1 张</span><b>面值 ¥{voucherAmount.toFixed(2)} ｜ 实收 ¥{voucherTotals.income.toFixed(2)} ｜ 优惠 ¥{voucherTotals.discount.toFixed(2)}</b></div>
              )}
            </div>
          ) : <div className="order-detail-empty compact">未使用优惠券</div>}
        </div>
      </div>

      <div className="order-detail-section">
        <div className="order-detail-section-title">付款信息</div>
        <div className="order-detail-summary three-columns payment-overview">
          <div><span>应收金额</span><b>¥{payable.toFixed(2)}</b></div>
          <div><span>实收金额</span><b>¥{netPaidTotal.toFixed(2)}</b></div>
          <div><span>付款方式</span><b>{paymentMethodLabel(order)}</b></div>
        </div>
        <div className="order-payment-list">
          {payments.length > 0 ? payments.map(payment => (
            <div key={payment.id}>
              <span>{payment.method === '微信支付' ? '微信' : payment.method}</span>
              <b>¥{payment.amount.toFixed(2)}</b>
              <time>{payment.time || '—'}</time>
            </div>
          )) : order.status === 'paid' && voucherTotals.income <= 0 ? (
            <div>
              <span>{paymentMethodLabel(order)}</span>
              <b>¥{paidTotal.toFixed(2)}</b>
              <time>{order.paid_at || '—'}</time>
            </div>
          ) : voucherTotals.income <= 0 ? <div className="order-payment-empty">暂无付款记录</div> : null}
          {voucherTotals.income > 0 && (
            <div className="order-voucher-payment-record">
              <span>优惠券收款</span>
              <b>¥{voucherTotals.income.toFixed(2)}</b>
              <time>{order.paid_at || order.submitted_at || '—'}</time>
            </div>
          )}
          {(order.refunds || []).map(refund => (
            <div key={refund.id} className="order-refund-record">
              <span>退款 · {refund.reason}</span>
              <b>-¥{refund.amount.toFixed(2)}</b>
              <time>{refund.time || '—'}</time>
            </div>
          ))}
        </div>
      </div>

      <div className="order-detail-section order-operation-section">
        <div className="order-detail-section-title order-detail-title-with-total">
          <span>操作日志</span><b>{operationLogs.length} 条记录</b>
        </div>
        <div className="order-operation-list">
          {operationLogs.length > 0 ? operationLogs.map(log => (
            <div key={log.id} className="order-operation-row">
              <time>{log.time}</time>
              <Tag color={operationCategoryColor[log.category] || 'default'}>{log.category}</Tag>
              <span className="operation-content"><b>{log.action}</b><em>{log.detail}</em></span>
              <span className="operation-operator">{log.operator || '收银员'}</span>
            </div>
          )) : <div className="order-detail-empty compact">暂无操作记录</div>}
        </div>
      </div>
    </div>
  )
}

export default OrderDetailBody
