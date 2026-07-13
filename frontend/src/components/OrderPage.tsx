import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import { Button, Input, Modal, Radio, message } from 'antd'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  GiftOutlined,
  MinusCircleOutlined,
  MinusOutlined,
  PlusOutlined,
  PrinterOutlined,
  ProfileOutlined,
  RetweetOutlined,
  RollbackOutlined,
  StopOutlined,
  SwapOutlined,
  TagOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import { formatAmount, formatMoney } from '../utils/money'
import { useAuth } from '../auth/AuthContext'

interface MenuItem {
  id: number
  name: string
  price: number
  english_name?: string
  abv?: string
  description?: string
  sale_status?: 'on_sale' | 'off_sale'
}

interface Category {
  name: string
  items: MenuItem[]
}

interface OrderItem {
  id: number
  menu_item_id?: number
  addition_pending?: boolean
  returned?: boolean
  return_reason?: string
  returned_at?: string
  name: string
  price: number
  quantity: number
  remark?: string
  discount?: number
  discount_reason?: string
  reduction?: number
  reduction_reason?: string
  gift_quantity?: number
  gift_reason?: string
  line_total?: number
}

interface PaymentRecord {
  id: string
  method: string
  amount: number
  time: string
}

interface VoucherDefinition {
  id: number
  name: string
  sale_price: number
  face_value: number
}

interface VoucherUsage {
  id: number
  name: string
  quantity: number
  face_value: number
  amount: number
}

interface CheckoutSummary {
  subtotal: number
  order_discount: number
  discount_amount: number
  order_reduction: number
  order_discount_reason?: string
  order_reduction_reason?: string
  voucher_name: string
  voucher_amount: number
  voucher_income_amount: number
  voucher_discount_amount: number
  voucher_items?: VoucherUsage[]
  round_down: number
  payable: number
  payments: PaymentRecord[]
  paid_total: number
  balance_due: number
}

interface Order {
  id: string
  table_id: string
  items: OrderItem[]
  total: number
  status: string
  remark?: string
  order_discount?: number
  order_reduction?: number
  voucher?: { name?: string; amount?: number }
  round_down?: number
  payments?: PaymentRecord[]
  payment_method?: string
  paid_amount?: number
  checkout?: CheckoutSummary
  created_by_user_id?: string
  created_by_user_name?: string
}

interface TableInfo {
  guests: number
  opened_at: string | null
  display_status?: string
  owned_by_current_user?: boolean
}

interface Props {
  tableId: string
  onBack: () => void
  onRequestTableAction?: (kind: 'transfer' | 'merge', sourceTableId: string) => void
  productionTicketEnabled: boolean
}

type AdjustmentReason = '退菜' | '赠菜' | '错点'
type ReturnReason = '多点' | '错点' | '顾客要求' | '其他'

type EditModalState =
  | { type: 'item-remark' }
  | { type: 'order-remark' }
  | { type: 'item-discount' }
  | { type: 'item-reduction' }
  | { type: 'item-gift' }
  | null

const ReturnReasonSelector: FC<{
  onChange: (reason: ReturnReason, detail: string) => void
}> = ({ onChange }) => {
  const [reason, setReason] = useState<ReturnReason>('多点')
  const [detail, setDetail] = useState('')

  return (
    <div className="return-reason-selector">
      <Radio.Group
        className="adjust-reason-group"
        value={reason}
        onChange={event => {
          const next = event.target.value as ReturnReason
          setReason(next)
          onChange(next, detail)
        }}
      >
        <Radio value="多点">多点</Radio>
        <Radio value="错点">错点</Radio>
        <Radio value="顾客要求">顾客要求</Radio>
        <Radio value="其他">其他</Radio>
      </Radio.Group>
      {reason === '其他' && (
        <Input
          value={detail}
          onChange={event => {
            setDetail(event.target.value)
            onChange(reason, event.target.value)
          }}
          placeholder="请输入其他原因（可选）"
          maxLength={50}
          allowClear
          autoFocus
        />
      )}
    </div>
  )
}

const parseMenuName = (name: string) => {
  const match = name.match(/^(.*)\s*\/\s*(杯|瓶)$/)
  if (!match) return { title: name, unit: null }
  return { title: match[1].trim(), unit: match[2] }
}

const formatItemBadge = (item: OrderItem) => {
  if (item.discount) {
    const remain = (100 - item.discount) / 10
    if (remain === 0) return '免费'
    return `${remain}折`
  }
  if (item.reduction) {
    return `-¥${formatAmount(item.reduction)}`
  }
  return null
}

const formatGiftBadge = (item: OrderItem) => {
  if (!item.gift_quantity) return null
  if (item.gift_quantity >= item.quantity) return '赠'
  return `赠${item.gift_quantity}`
}

const itemDisplayTotal = (item: OrderItem) => {
  if (item.line_total != null) return item.line_total
  const giftQty = Math.min(item.gift_quantity || 0, item.quantity)
  let line = item.price * (item.quantity - giftQty)
  if (item.discount) line *= (1 - item.discount / 100)
  if (item.reduction) line -= item.reduction
  return Math.max(0, line)
}

interface CheckoutPanelProps {
  order: Order
  onUpdated: () => void
  onFinalize: () => void
  finalizing: boolean
  readOnly?: boolean
}

const CheckoutPanel: FC<CheckoutPanelProps> = ({ order, onUpdated, onFinalize, finalizing, readOnly = false }) => {
  const { hasPermission } = useAuth()
  const canPerform = (permission: string) => !readOnly && hasPermission(permission)
  const summary = order.checkout
  const [discountInput, setDiscountInput] = useState<string>(
    summary?.order_discount ? String(100 - summary.order_discount) : '100'
  )
  const [reductionInput, setReductionInput] = useState<string>(
    summary?.order_reduction ? String(summary.order_reduction) : ''
  )
  const [paymentModal, setPaymentModal] = useState<'scan' | 'cash' | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [amountEditing, setAmountEditing] = useState(false)
  const [roundDownEditing, setRoundDownEditing] = useState(false)
  const [replacePaymentAmountOnInput, setReplacePaymentAmountOnInput] = useState(false)
  const paymentAmountInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [orderOfferModal, setOrderOfferModal] = useState<'reduction' | 'discount' | null>(null)
  const [voucherOpen, setVoucherOpen] = useState(false)
  const [voucherDefinitions, setVoucherDefinitions] = useState<VoucherDefinition[]>([])
  const [voucherQuantities, setVoucherQuantities] = useState<Record<number, number>>({})
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [orderDiscountReason, setOrderDiscountReason] = useState(summary?.order_discount_reason || '')
  const [orderReductionReason, setOrderReductionReason] = useState(summary?.order_reduction_reason || '')

  useEffect(() => {
    if (!summary) return
    setDiscountInput(summary.order_discount ? String(100 - summary.order_discount) : '100')
    setReductionInput(summary.order_reduction ? String(summary.order_reduction) : '')
    setOrderDiscountReason(summary.order_discount_reason || '')
    setOrderReductionReason(summary.order_reduction_reason || '')
    if (!paymentModal) setPaymentAmount(summary.balance_due > 0 ? summary.balance_due.toFixed(2) : '')
  }, [order.id, summary?.subtotal, summary?.order_discount, summary?.order_reduction,
    summary?.voucher_name, summary?.voucher_amount, summary?.round_down, summary?.balance_due])

  useLayoutEffect(() => {
    if (!amountEditing && !roundDownEditing) return
    paymentAmountInputRef.current?.focus({ preventScroll: true })
    paymentAmountInputRef.current?.select()
  }, [amountEditing, roundDownEditing])

  useEffect(() => {
    if (!voucherOpen) return
    axios.get('/api/vouchers')
      .then(res => {
        if (res.data.success) setVoucherDefinitions(res.data.data)
      })
      .catch(() => message.error('获取优惠券失败'))
  }, [voucherOpen])

  if (!summary) return null

  const callConfig = async (payload: Record<string, any>) => {
    setSaving(true)
    try {
      const res = await axios.patch(`/api/order/${order.table_id}/checkout-config`, payload)
      if (res.data.success) {
        await onUpdated()
        return true
      } else {
        message.error(res.data.error || '更新失败')
        return false
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const applyDiscount = async () => {
    const kept = Number(discountInput)
    if (!Number.isFinite(kept) || kept < 0 || kept > 100) {
      message.error('折扣应在 0-100 之间')
      return
    }
    const success = await callConfig({
      order_discount: 100 - kept,
      order_discount_reason: orderDiscountReason.trim(),
    })
    if (success) setOrderOfferModal(null)
  }

  const applyReduction = async () => {
    const v = Number(reductionInput) || 0
    if (v < 0) {
      message.error('减免不能为负')
      return
    }
    const maxReduction = Math.max(0, summary.subtotal - summary.discount_amount)
    if (v > maxReduction) {
      message.error(`订单减免不能超过 ${money(maxReduction)}`)
      return
    }
    const success = await callConfig({
      order_reduction: v,
      order_reduction_reason: orderReductionReason.trim(),
    })
    if (success) setOrderOfferModal(null)
  }

  const openVoucherModal = () => {
    const quantities = (summary.voucher_items || []).reduce<Record<number, number>>((result, item) => {
      result[item.id] = item.quantity
      return result
    }, {})
    setVoucherQuantities(quantities)
    setVoucherOpen(true)
  }

  const changeVoucherQuantity = (voucherId: number, change: number) => {
    setVoucherQuantities(current => ({
      ...current,
      [voucherId]: Math.max(0, Math.min(99, (current[voucherId] || 0) + change)),
    }))
  }

  const applyConfiguredVouchers = async () => {
    const items = voucherDefinitions
      .map(voucher => ({ id: voucher.id, quantity: voucherQuantities[voucher.id] || 0 }))
      .filter(item => item.quantity > 0)
    const success = await callConfig({
      voucher: { items },
    })
    if (success) setVoucherOpen(false)
  }

  const openRoundDown = () => {
    const payableBeforeRoundDown = summary.payable + summary.round_down
    const tailAmount = Math.round((payableBeforeRoundDown % 10) * 100) / 100
    setPaymentAmount(tailAmount.toFixed(2))
    setReplacePaymentAmountOnInput(true)
    setRoundDownEditing(true)
  }

  const applyRoundDown = async () => {
    const amount = Number(paymentAmount) || 0
    const payableBeforeRoundDown = summary.payable + summary.round_down
    if (amount < 0 || amount > payableBeforeRoundDown) {
      message.error(`抹零金额不能超过 ${money(payableBeforeRoundDown)}`)
      return
    }
    const success = await callConfig({ round_down: amount })
    if (success) setRoundDownEditing(false)
  }

  const applyFreeOrder = () => {
    if (summary.order_discount === 100) {
      Modal.confirm({
        title: '撤销免单',
        content: '确认撤销当前订单的免单优惠？',
        okText: '确认撤销',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => callConfig({ order_discount: 0, order_discount_reason: '' }),
      })
      return
    }
    setOrderOfferModal(null)
    Modal.confirm({
      title: '确认免单',
      content: '免单会取消所有优惠，确认将当前订单设为免单？',
      okText: '确认免单',
      cancelText: '取消',
      onOk: () => callConfig({
        order_discount: 100,
        order_discount_reason: '免单',
        order_reduction: 0,
        order_reduction_reason: '',
        voucher: { name: '', amount: 0 },
        round_down: 0,
        clear_all_offers: true,
      }),
    })
  }

  const addPayment = async (method: '微信支付' | '支付宝' | '现金') => {
    const amount = Number(paymentAmount) || 0
    if (amount <= 0) {
      message.error('收款金额必须大于 0')
      return
    }
    setAdding(true)
    try {
      const res = await axios.post(`/api/order/${order.table_id}/payment`, {
        method,
        amount,
      })
      if (res.data.success) {
        setPaymentModal(null)
        setAmountEditing(false)
        await onUpdated()
      } else {
        message.error(res.data.error || '收款失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '收款失败')
    } finally {
      setAdding(false)
    }
  }

  const revertPayment = async (paymentId: string) => {
    try {
      const res = await axios.delete(
        `/api/order/${order.table_id}/payment/${encodeURIComponent(paymentId)}`
      )
      if (res.data.success) {
        onUpdated()
      } else {
        message.error(res.data.error || '撤销失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '撤销失败')
    }
  }

  const money = (v: number) => formatMoney(v)
  const balanceIsPositive = summary.balance_due > 0.01
  const financialAdjustmentsLocked = summary.paid_total > 0.005 && !balanceIsPositive
  const originalItemsTotal = order.items.reduce(
    (sum, item) => sum + (item.returned ? 0 : item.price * item.quantity),
    0
  )
  const itemSavings = Math.max(0, originalItemsTotal - summary.subtotal)
  const totalSavings = itemSavings + summary.discount_amount + summary.order_reduction + summary.voucher_discount_amount + summary.round_down
  const maxOrderReduction = Math.max(0, summary.subtotal - summary.discount_amount)
  const orderReductionQuickValues = [10, 20, 50, 100, Math.floor(maxOrderReduction / 2), maxOrderReduction]
    .filter(value => value > 0 && value <= maxOrderReduction)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((a, b) => a - b)
    .slice(0, 5)

  const openOrderOffer = (type: 'reduction' | 'discount') => {
    const isReduction = type === 'reduction'
    const hasValue = isReduction ? summary.order_reduction > 0 : summary.order_discount > 0
    if (hasValue) {
      Modal.confirm({
        title: isReduction ? '撤销订单减免' : '撤销订单打折',
        content: isReduction
          ? `确认撤销当前订单减免 ${money(summary.order_reduction)}？`
          : `确认撤销当前订单打折（${100 - summary.order_discount}%）？`,
        okText: '确认撤销',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => callConfig(isReduction
          ? { order_reduction: 0, order_reduction_reason: '' }
          : { order_discount: 0, order_discount_reason: '' }),
      })
      return
    }

    if (isReduction) {
      setReductionInput('')
      setOrderReductionReason('')
    } else {
      setDiscountInput('100')
      setOrderDiscountReason('')
    }
    setOrderOfferModal(type)
  }

  const pressOrderDiscountKey = (key: string) => {
    setDiscountInput(current => {
      const cur = current === '' ? '0' : current
      if (key === 'clear') return '0'
      if (key === 'backspace') return cur.length <= 1 ? '0' : cur.slice(0, -1)
      const next = cur === '0' ? key : `${cur}${key}`
      return Number(next) <= 100 ? next : cur
    })
  }

  const pressOrderReductionKey = (key: string) => {
    setReductionInput(current => {
      const cur = current === '' ? '0' : current
      if (key === 'clear') return '0'
      if (key === 'backspace') return cur.length <= 1 ? '0' : cur.slice(0, -1)
      if (key === '.') return cur.includes('.') ? cur : `${cur}.`
      const next = cur === '0' ? key : `${cur}${key}`
      const amount = Number(next)
      return !Number.isNaN(amount) && amount <= maxOrderReduction ? next : cur
    })
  }

  const openPayment = (type: 'scan' | 'cash') => {
    setPaymentAmount(summary.balance_due > 0 ? summary.balance_due.toFixed(2) : '')
    setAmountEditing(false)
    setPaymentModal(type)
  }

  const pressPaymentAmountKey = (key: string) => {
    if (replacePaymentAmountOnInput && key !== 'backspace' && key !== 'clear') {
      setReplacePaymentAmountOnInput(false)
      setPaymentAmount(key === '.' ? '0.' : key === '00' ? '0' : key)
      return
    }
    setReplacePaymentAmountOnInput(false)
    setPaymentAmount(current => {
      if (key === 'clear') return ''
      if (key === 'backspace') return current.length <= 1 ? '' : current.slice(0, -1)
      if (key === '.') return current.includes('.') ? current : `${current || '0'}.`
      if (key === '00' && (!current || current === '0')) return '0'
      const next = current === '0' ? key : `${current}${key}`
      return /^\d*(\.\d{0,2})?$/.test(next) ? next : current
    })
  }

  const handleBalanceAction = () => {
    if (!balanceIsPositive) onFinalize()
  }

  return (
    <div className="settlement-card">
      <section className="settlement-options">
        <div className="settlement-section">
          <h3>选择优惠</h3>
          <div className="settlement-choice-grid offer-grid">
            {canPerform('order.reduction') && <button type="button" disabled={financialAdjustmentsLocked} className={summary.order_reduction > 0 ? 'active' : ''} onClick={() => openOrderOffer('reduction')}>订单减免</button>}
            {canPerform('order.discount') && <button type="button" disabled={financialAdjustmentsLocked} className={summary.order_discount > 0 && summary.order_discount < 100 ? 'active' : ''} onClick={() => openOrderOffer('discount')}>订单打折</button>}
            {canPerform('order.free') && <button type="button" disabled={financialAdjustmentsLocked} className={summary.order_discount === 100 ? 'active' : ''} onClick={applyFreeOrder}>免单</button>}
          </div>
        </div>

        <div className="settlement-section payment-section">
          <h3>选择支付方式</h3>
          <div className="settlement-choice-grid payment-grid">
            {canPerform('payment.collect') && <button type="button" onClick={() => openPayment('scan')}>扫码支付</button>}
            {canPerform('payment.collect') && <button type="button" onClick={() => openPayment('cash')}>现金</button>}
            {canPerform('voucher.view') && <button type="button" disabled={financialAdjustmentsLocked} className={voucherOpen ? 'active' : ''} onClick={openVoucherModal}>优惠券抵扣</button>}
          </div>
        </div>
      </section>

      <section className="settlement-bill">
        <h3>账单明细</h3>
        <div className="settlement-ledger">
          <div><span>菜品价格合计</span><b>{money(originalItemsTotal)} 元</b></div>
          <div className="discount-total-row">
            <span>优惠合计</span>
            <b>- {money(totalSavings)} 元</b>
            <button type="button" onClick={() => setDetailsExpanded(open => !open)}>{detailsExpanded ? '收起' : '展开'}</button>
          </div>
          {detailsExpanded && (
            <div className="discount-breakdown">
              {itemSavings > 0 && <div><span>菜品优惠</span><b>-{money(itemSavings)}</b></div>}
              {summary.discount_amount > 0 && <div><span>订单打折{summary.order_discount_reason ? ` · ${summary.order_discount_reason}` : ''}</span><b>-{money(summary.discount_amount)}</b></div>}
              {summary.order_reduction > 0 && <div><span>订单减免{summary.order_reduction_reason ? ` · ${summary.order_reduction_reason}` : ''}</span><b>-{money(summary.order_reduction)}</b></div>}
              {summary.voucher_discount_amount > 0 && <div><span>优惠券优惠</span><b>-{money(summary.voucher_discount_amount)}</b></div>}
              {summary.round_down > 0 && <div><span>抹零</span><b>-{money(summary.round_down)}</b></div>}
            </div>
          )}
          <div className="payable-row">
            <span>应收</span>
            <b>{money(summary.payable)} 元</b>
            {canPerform('order.round_down') && <button type="button" disabled={saving || financialAdjustmentsLocked} onClick={openRoundDown}>抹零</button>}
          </div>
          {summary.voucher_amount > 0 && (
            <div className="voucher-deduction-row">
              <span>优惠券抵扣</span>
              <b>面值 {money(summary.voucher_amount)} 元</b>
              {canPerform('voucher.view') && <button
                type="button"
                disabled={saving}
                onClick={() => callConfig({ voucher: { items: [] } })}
              >撤销</button>}
            </div>
          )}
          {summary.voucher_income_amount > 0 && (
            <div className="payment-record-row voucher-payment-record">
              <span>优惠券 收款</span>
              <b>{money(summary.voucher_income_amount)} 元</b>
              <i>优惠 {money(summary.voucher_discount_amount)}</i>
            </div>
          )}
          {summary.payments.map(payment => (
            <div className="payment-record-row" key={payment.id}>
              <span>{payment.method === '微信支付' ? '微信' : payment.method} 收款</span>
              <b>{money(payment.amount)} 元</b>
              {canPerform('payment.revoke') && <button type="button" onClick={() => revertPayment(payment.id)}>撤销</button>}
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`balance-action${balanceIsPositive ? '' : ' settled'}`}
          disabled={balanceIsPositive || adding || finalizing || !canPerform('payment.checkout') || !canPerform('table.clear')}
          onClick={handleBalanceAction}
        >
          {balanceIsPositive ? <>还差 <span className="balance-due-amount">{money(summary.balance_due)}</span> 元</> : '已结清 · 清台'}
        </button>
      </section>

      <Modal
        title={paymentModal === 'scan' ? '扫码支付' : '现金'}
        open={paymentModal !== null && !amountEditing}
        onCancel={() => setPaymentModal(null)}
        footer={null}
        width={440}
        destroyOnClose
      >
        <div className="payment-modal-body">
          <div className="payment-modal-amount">
            <strong>{money(Number(paymentAmount) || 0)}</strong>
            <button type="button" onClick={() => {
              setReplacePaymentAmountOnInput(true)
              setAmountEditing(true)
            }}>修改金额</button>
          </div>
          {paymentModal === 'scan' ? (
            <div className="payment-method-tabs">
              <button type="button" disabled={adding} onClick={() => addPayment('微信支付')}>微信</button>
              <button type="button" disabled={adding} onClick={() => addPayment('支付宝')}>支付宝</button>
            </div>
          ) : (
            <button type="button" className="cash-payment-confirm" disabled={adding} onClick={() => addPayment('现金')}>
              {adding ? '收款中…' : '确认现金收款'}
            </button>
          )}
        </div>
      </Modal>

      <Modal
        title={roundDownEditing ? '抹零' : '修改金额'}
        open={(paymentModal !== null && amountEditing) || roundDownEditing}
        onCancel={() => {
          setAmountEditing(false)
          setRoundDownEditing(false)
        }}
        footer={null}
        width={440}
        destroyOnClose
      >
        <div className="discount-form payment-amount-editor">
          <div className="discount-input-row">
            <div className="discount-input-wrap has-prefix">
              <span className="discount-input-prefix">¥</span>
              <input
                className={`discount-input${replacePaymentAmountOnInput ? ' amount-selection-active' : ''}`}
                ref={paymentAmountInputRef}
                type="text"
                inputMode="decimal"
                value={paymentAmount}
                onChange={event => {
                  const raw = event.target.value.replace(/[^\d.]/g, '')
                  if (/^\d*(\.\d{0,2})?$/.test(raw)) {
                    setReplacePaymentAmountOnInput(false)
                    setPaymentAmount(raw)
                  }
                }}
                onFocus={event => event.currentTarget.select()}
                onKeyDown={event => {
                  if (!replacePaymentAmountOnInput) return
                  if (/^\d$/.test(event.key) || event.key === '.') {
                    event.preventDefault()
                    setReplacePaymentAmountOnInput(false)
                    setPaymentAmount(event.key === '.' ? '0.' : event.key)
                  } else if (event.key === 'Backspace' || event.key === 'Delete') {
                    event.preventDefault()
                    setReplacePaymentAmountOnInput(false)
                    setPaymentAmount('')
                  }
                }}
                placeholder="0.00"
                autoFocus
              />
              {replacePaymentAmountOnInput && paymentAmount && (
                <span className="payment-amount-selection-preview" aria-hidden="true">{paymentAmount}</span>
              )}
            </div>
          </div>
          <div className="discount-keypad payment-keypad">
            {['1', '2', '3'].map(key => (
              <button key={key} type="button" className="discount-key" onClick={() => pressPaymentAmountKey(key)}>{key}</button>
            ))}
            <button type="button" className="discount-key aux payment-keypad-backspace" onClick={() => pressPaymentAmountKey('backspace')} aria-label="退格">
              <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true"><path d="M9 2H25V18H9L2 10L9 2Z" /><path d="M13 7L19 13M19 7L13 13" /></svg>
            </button>
            {['4', '5', '6'].map(key => (
              <button key={key} type="button" className="discount-key" onClick={() => pressPaymentAmountKey(key)}>{key}</button>
            ))}
            <button type="button" className="discount-key aux payment-keypad-clear" onClick={() => pressPaymentAmountKey('clear')}>清空</button>
            {['7', '8', '9'].map(key => (
              <button key={key} type="button" className="discount-key" onClick={() => pressPaymentAmountKey(key)}>{key}</button>
            ))}
            <button
              type="button"
              className="discount-key payment-keypad-confirm"
              disabled={saving || (!roundDownEditing && (Number(paymentAmount) || 0) <= 0)}
              onClick={roundDownEditing ? applyRoundDown : () => setAmountEditing(false)}
            >确认</button>
            <button type="button" className="discount-key" onClick={() => pressPaymentAmountKey('.')}>.</button>
            <button type="button" className="discount-key" onClick={() => pressPaymentAmountKey('0')}>0</button>
            <button type="button" className="discount-key" onClick={() => pressPaymentAmountKey('00')}>00</button>
          </div>
        </div>
      </Modal>

      <Modal
        title="优惠券"
        open={voucherOpen}
        onCancel={() => setVoucherOpen(false)}
        footer={null}
        width={520}
        destroyOnClose
      >
        <div className="voucher-modal-body">
          {voucherDefinitions.length > 0 ? (
            <div className="voucher-config-list">
              {voucherDefinitions.map(voucher => (
                <div
                  key={voucher.id}
                  className={`voucher-choice-card${(voucherQuantities[voucher.id] || 0) > 0 ? ' selected' : ''}`}
                  onClick={() => {
                    if (!(voucherQuantities[voucher.id] || 0)) changeVoucherQuantity(voucher.id, 1)
                  }}
                >
                  <div className="voucher-choice-info">
                    <strong>{voucher.name}</strong>
                    <span>{voucher.sale_price > 0 ? `¥${voucher.sale_price.toFixed(2)} 代 ` : '抵扣 '}¥{voucher.face_value.toFixed(2)}</span>
                  </div>
                  <div className="voucher-quantity" onClick={event => event.stopPropagation()}>
                    <button type="button" disabled={saving || !(voucherQuantities[voucher.id] || 0)} onClick={() => changeVoucherQuantity(voucher.id, -1)}>−</button>
                    <b>{voucherQuantities[voucher.id] || 0}</b>
                    <button type="button" disabled={saving || (voucherQuantities[voucher.id] || 0) >= 99} onClick={() => changeVoucherQuantity(voucher.id, 1)}>＋</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="voucher-config-empty">暂无可用优惠券，请先在设置中添加</div>
          )}
          <div className="voucher-modal-footer">
            <span>抵扣合计 <b>{money(voucherDefinitions.reduce((sum, voucher) => sum + voucher.face_value * (voucherQuantities[voucher.id] || 0), 0))}</b></span>
            <Button onClick={() => setVoucherOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={applyConfiguredVouchers}>确认使用</Button>
          </div>
        </div>
      </Modal>

      <Modal
        title="订单减免"
        open={orderOfferModal === 'reduction'}
        onCancel={() => setOrderOfferModal(null)}
        footer={null}
        width={420}
        destroyOnClose
      >
        <div className="discount-form">
          <div className="discount-input-row">
            <div className="discount-input-wrap has-prefix">
              <span className="discount-input-prefix">¥</span>
              <input
                className="discount-input"
                type="text"
                inputMode="decimal"
                value={reductionInput}
                onChange={event => {
                  const raw = event.target.value.replace(/[^\d.]/g, '')
                  if (raw === '') { setReductionInput(''); return }
                  const amount = Number(raw)
                  if (!Number.isNaN(amount) && amount <= maxOrderReduction) setReductionInput(raw)
                }}
                placeholder="0"
              />
            </div>
          </div>
          <div className="edit-number-hint">订单折后金额 {money(maxOrderReduction)}，减免不能超过该金额</div>
          <div className="discount-quick-chips">
            {orderReductionQuickValues.map(value => (
              <button key={value} type="button" className={`discount-chip${reductionInput === String(value) ? ' active' : ''}`} onClick={() => setReductionInput(String(value))}>¥{formatAmount(value)}</button>
            ))}
          </div>
          <div className="discount-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key => (
              <button key={key} type="button" className="discount-key" onClick={() => pressOrderReductionKey(key)}>{key}</button>
            ))}
            <button type="button" className="discount-key aux" onClick={() => pressOrderReductionKey('.')}>.</button>
            <button type="button" className="discount-key" onClick={() => pressOrderReductionKey('0')}>0</button>
            <button type="button" className="discount-key aux" onClick={() => pressOrderReductionKey('backspace')} aria-label="退格">
              <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true"><path d="M9 2H25V18H9L2 10L9 2Z" /><path d="M13 7L19 13M19 7L13 13" /></svg>
            </button>
          </div>
          <div className="discount-reason-row">
            <input className="discount-reason-input" type="text" value={orderReductionReason} onChange={event => setOrderReductionReason(event.target.value)} placeholder="减免原因（可选）" maxLength={50} />
          </div>
          <button type="button" className="discount-confirm-btn" disabled={saving} onClick={applyReduction}>确认</button>
        </div>
      </Modal>

      <Modal
        title="订单打折"
        open={orderOfferModal === 'discount'}
        onCancel={() => setOrderOfferModal(null)}
        footer={null}
        width={420}
        destroyOnClose
      >
        <div className="discount-form">
          <div className="discount-input-row">
            <div className="discount-input-wrap">
              <input
                className="discount-input"
                type="text"
                inputMode="numeric"
                value={discountInput}
                onChange={event => {
                  const raw = event.target.value.replace(/[^\d]/g, '')
                  if (raw === '') { setDiscountInput(''); return }
                  const percent = Number(raw)
                  if (percent <= 100) setDiscountInput(raw)
                }}
                placeholder="如 80"
              />
              <span className="discount-input-suffix">%</span>
            </div>
          </div>
          <div className="edit-number-hint">输入实付比例，例如 80% 表示 8 折</div>
          <div className="discount-quick-chips">
            {[50, 60, 80, 85, 88].map(value => (
              <button key={value} type="button" className={`discount-chip${discountInput === String(value) ? ' active' : ''}`} onClick={() => setDiscountInput(String(value))}>{value}%</button>
            ))}
          </div>
          <div className="discount-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key => (
              <button key={key} type="button" className="discount-key" onClick={() => pressOrderDiscountKey(key)}>{key}</button>
            ))}
            <button type="button" className="discount-key aux" onClick={() => pressOrderDiscountKey('clear')}>清空</button>
            <button type="button" className="discount-key" onClick={() => pressOrderDiscountKey('0')}>0</button>
            <button type="button" className="discount-key aux" onClick={() => pressOrderDiscountKey('backspace')} aria-label="退格">
              <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true"><path d="M9 2H25V18H9L2 10L9 2Z" /><path d="M13 7L19 13M19 7L13 13" /></svg>
            </button>
          </div>
          <div className="discount-reason-row">
            <input className="discount-reason-input" type="text" value={orderDiscountReason} onChange={event => setOrderDiscountReason(event.target.value)} placeholder="打折原因（可选）" maxLength={50} />
          </div>
          <button type="button" className="discount-confirm-btn" disabled={saving} onClick={applyDiscount}>确认</button>
        </div>
      </Modal>
    </div>
  )
}

function OrderPage({ tableId, onBack, onRequestTableAction, productionTicketEnabled }: Props) {
  const { user, hasPermission } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState(-1)
  const [order, setOrder] = useState<Order | null>(null)
  const [initialOrderLoading, setInitialOrderLoading] = useState(true)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [addingAfterSubmit, setAddingAfterSubmit] = useState(false)
  const [guestEditorVisible, setGuestEditorVisible] = useState(false)
  const [guestInput, setGuestInput] = useState('1')
  const [guestInputDirty, setGuestInputDirty] = useState(false)
  const [editModal, setEditModal] = useState<EditModalState>(null)
  const [editInput, setEditInput] = useState('')
  const [editGiftReason, setEditGiftReason] = useState('')
  const [editDiscountReason, setEditDiscountReason] = useState('')
  const [editReductionReason, setEditReductionReason] = useState('')
  const [reprintMode, setReprintMode] = useState(false)
  const [reprintQuantities, setReprintQuantities] = useState<Record<number, number>>({})
  const [tableInfo, setTableInfo] = useState<TableInfo>({ guests: 0, opened_at: null })
  const isGuest = Boolean(user?.roles.some(role => role.code === 'guest'))
  const guestReadOnly = isGuest && (
    order
      ? order.created_by_user_id !== user?.id
      : Boolean(tableInfo.opened_at) && tableInfo.owned_by_current_user === false
  )
  const canPerform = (permission: string) => !guestReadOnly && hasPermission(permission)

  useLayoutEffect(() => {
    setOrder(null)
    setInitialOrderLoading(true)
    setAddingAfterSubmit(false)
    setSelectedItemId(null)
    setReprintMode(false)
    setReprintQuantities({})
  }, [tableId])

  useEffect(() => {
    if (hasPermission('menu.view')) fetchMenu()
    fetchOrder(true)
    fetchTableInfo()
  }, [tableId])

  const fetchMenu = async () => {
    try {
      const res = await axios.get('/api/menu')
      if (res.data.success) {
        const availableCategories = (res.data.data.categories as Category[])
          .map(category => ({
            ...category,
            items: (category.items || []).filter(item => item.sale_status !== 'off_sale'),
          }))
          .filter(category => category.items.length > 0)
        setCategories(availableCategories)
      }
    } catch (e) {
      message.error('获取菜单失败')
    }
  }

  const fetchOrder = async (showInitialLoading = false) => {
    if (showInitialLoading) setInitialOrderLoading(true)
    try {
      const res = await axios.get(`/api/order/${tableId}`)
      if (res.data.success) {
        const nextOrder: Order | null = res.data.data
        if (!nextOrder) {
          setOrder(null)
          return
        }
        const cachedAdditions = nextOrder.items?.filter(item => item.addition_pending) || []
        if (cachedAdditions.length > 0) {
          setAddingAfterSubmit(true)
          setSelectedItemId(cachedAdditions[0].id)
        }
        setOrder(nextOrder)
      }
    } catch (e) {
      message.error('获取订单失败')
    } finally {
      if (showInitialLoading) setInitialOrderLoading(false)
    }
  }

  const fetchTableInfo = async () => {
    try {
      const res = await axios.get(`/api/table/${tableId}`)
      if (res.data.success) {
        setTableInfo(res.data.data)
      }
    } catch (e) {
      message.error('获取桌台信息失败')
    }
  }

  const addItem = async (item: MenuItem) => {
    if (!canPerform('order.add_item') || (addingAfterSubmit && !canPerform('order.addition'))) return
    try {
      const res = await axios.post(`/api/order/${tableId}/item`, {
        item_id: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        add_mode_change: addingAfterSubmit,
      })
      if (res.data.success) {
        setOrder(res.data.data)
        if (addingAfterSubmit) {
          const newestAddition = (res.data.data.items as OrderItem[]).find(item => item.addition_pending)
          setSelectedItemId(newestAddition?.id ?? null)
        }
      } else {
        message.error(res.data.error || '添加菜品失败')
      }
    } catch (e) {
      message.error('添加菜品失败')
    }
  }

  const removeItemDirect = async (itemId: number, data?: Record<string, unknown>) => {
    try {
      const res = await axios.delete(`/api/order/${tableId}/item/${itemId}`, data ? { data } : undefined)
      if (res.data.success) {
        setOrder(res.data.data)
      }
    } catch (e) {
      message.error('删除菜品失败')
    }
  }

  const clearAllItems = async () => {
    if (addingAfterSubmit) {
      try {
        const res = await axios.delete(`/api/order/${tableId}/additions`)
        if (res.data.success) {
          setOrder(res.data.data)
          setSelectedItemId(null)
        }
      } catch (e: any) {
        message.error(e?.response?.data?.error || '清空加菜失败')
      }
      return
    }
    const items = order?.items || []
    if (items.length === 0) return
    try {
      let latest: Order | undefined
      for (const item of items) {
        const res = await axios.delete(`/api/order/${tableId}/item/${item.id}`)
        if (res.data.success) {
          latest = res.data.data
        }
      }
      if (latest) setOrder(latest)
    } catch (e) {
      message.error('清空失败')
      fetchOrder()
    }
  }

  const removeItemWithReason = async (itemId: number, reason: AdjustmentReason) => {
    try {
      const res = await axios.delete(`/api/order/${tableId}/item/${itemId}`, { data: { reason } })
      if (res.data.success) {
        setOrder(res.data.data)
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除菜品失败')
    }
  }

  const returnSelectedItem = () => {
    if (selectedItemId == null) return
    const itemId = selectedItemId
    let selectedReason: ReturnReason = '多点'
    let detail = ''
    Modal.confirm({
      className: 'return-reason-modal',
      icon: null,
      title: '选择退菜理由',
      content: (
        <ReturnReasonSelector
          onChange={(reason, value) => {
            selectedReason = reason
            detail = value.trim()
          }}
        />
      ),
      okText: '确认退菜',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const reason = selectedReason === '其他' && detail
          ? `其他：${detail}`
          : selectedReason
        try {
          const res = await axios.delete(`/api/order/${tableId}/item/${itemId}`, {
            data: { reason, return_item: true },
          })
          if (res.data.success) setOrder(res.data.data)
          else throw new Error(res.data.error || '退菜失败')
        } catch (e: any) {
          message.error(e?.response?.data?.error || e?.message || '退菜失败')
          throw e
        }
      },
    })
  }

  const updateQuantity = async (itemId: number, quantity: number) => {
    return updateQuantityDirect(itemId, quantity)
  }

  const updateQuantityDirect = async (itemId: number, quantity: number, extraData?: Record<string, unknown>) => {
    if (quantity <= 0) {
      removeItemDirect(itemId, extraData)
      return
    }

    try {
      const res = await axios.put(`/api/order/${tableId}/item/${itemId}/quantity`, { quantity, ...extraData })
      if (res.data.success) {
        setOrder(res.data.data)
      }
    } catch (e) {
      message.error('更新数量失败')
    }
  }

  const updateQuantityWithReason = async (itemId: number, quantity: number, reason: AdjustmentReason) => {
    if (quantity <= 0) {
      removeItemWithReason(itemId, reason)
      return
    }

    try {
      const res = await axios.put(`/api/order/${tableId}/item/${itemId}/quantity`, { quantity, reason })
      if (res.data.success) {
        setOrder(res.data.data)
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新数量失败')
    }
  }

  const requestAdjustmentReason = (onConfirm: (reason: AdjustmentReason) => void) => {
    let selectedReason: AdjustmentReason = '退菜'
    Modal.confirm({
      title: '请选择修改原因',
      content: (
        <Radio.Group
          className="adjust-reason-group"
          defaultValue={selectedReason}
          onChange={e => { selectedReason = e.target.value }}
        >
          <Radio value="退菜">退菜</Radio>
          <Radio value="赠菜">赠菜</Radio>
          <Radio value="错点">错点</Radio>
        </Radio.Group>
      ),
      okText: '确认',
      cancelText: '取消',
      onOk: () => onConfirm(selectedReason),
    })
  }

  const removeSelectedItem = (reason?: AdjustmentReason) => {
    if (selectedItemId == null) return
    if (order?.status === 'pending') {
      removeItemDirect(selectedItemId)
      return
    }
    if (addingAfterSubmit) {
      const item = orderItems.find(i => i.id === selectedItemId)
      if (!item?.addition_pending) return
      removeItemDirect(selectedItemId, { add_mode_change: true })
      return
    }
    if (reason) {
      removeItemWithReason(selectedItemId, reason)
    } else {
      requestAdjustmentReason(r => removeItemWithReason(selectedItemId, r))
    }
  }

  const adjustSelectedItemQuantity = (nextQuantity: number) => {
    if (selectedItemId == null || !selectedItem) return
    handleUpdateQuantity(selectedItemId, nextQuantity)
  }

  const openItemRemark = () => {
    if (!selectedItem) return
    setEditInput(selectedItem.remark || '')
    setEditModal({ type: 'item-remark' })
  }

  const openOrderRemark = () => {
    setEditInput(order?.remark || '')
    setEditModal({ type: 'order-remark' })
  }

  const openItemDiscount = () => {
    if (!selectedItem) return
    const kept = 100 - (selectedItem.discount || 0)
    setEditInput(String(kept))
    setEditDiscountReason(selectedItem.discount_reason || '')
    setEditModal({ type: 'item-discount' })
  }

  const clearDiscount = async () => {
    if (selectedItemId == null) return
    try {
      const res = await axios.patch(`/api/order/${tableId}/item/${selectedItemId}`, { discount: 0 })
      if (res.data.success) {
        setOrder(res.data.data)
      } else {
        message.error(res.data.error || '操作失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败')
    }
  }

  const openItemReduction = () => {
    if (!selectedItem) return
    setEditInput(String(selectedItem.reduction || 0))
    setEditReductionReason(selectedItem.reduction_reason || '')
    setEditModal({ type: 'item-reduction' })
  }

  const clearReduction = async () => {
    if (selectedItemId == null) return
    try {
      const res = await axios.patch(`/api/order/${tableId}/item/${selectedItemId}`, { reduction: 0 })
      if (res.data.success) {
        setOrder(res.data.data)
      } else {
        message.error(res.data.error || '操作失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败')
    }
  }

  const openItemGift = () => {
    if (!selectedItem) return
    setEditInput(String(selectedItem.gift_quantity || 1))
    setEditGiftReason(selectedItem.gift_reason || '生日礼')
    setEditModal({ type: 'item-gift' })
  }

  const clearGift = async () => {
    if (selectedItemId == null) return
    try {
      const res = await axios.patch(`/api/order/${tableId}/item/${selectedItemId}`, { gift_quantity: 0 })
      if (res.data.success) {
        setOrder(res.data.data)
        setEditModal(null)
      } else {
        message.error(res.data.error || '操作失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败')
    }
  }

  const submitEdit = async () => {
    if (!editModal) return
    const type = editModal.type
    try {
      let res
      if (type === 'item-remark' && selectedItemId != null) {
        res = await axios.patch(`/api/order/${tableId}/item/${selectedItemId}`, { remark: editInput.trim() })
      } else if (type === 'order-remark') {
        res = await axios.put(`/api/order/${tableId}/remark`, { remark: editInput.trim() })
      } else if (type === 'item-discount' && selectedItemId != null) {
        const kept = Math.max(0, Math.min(100, Number(editInput) || 0))
        const discount = Math.max(0, Math.min(100, 100 - kept))
        res = await axios.patch(`/api/order/${tableId}/item/${selectedItemId}`, {
          discount,
          discount_reason: editDiscountReason.trim(),
        })
      } else if (type === 'item-reduction' && selectedItemId != null) {
        const reduction = Number(editInput) || 0
        res = await axios.patch(`/api/order/${tableId}/item/${selectedItemId}`, {
          reduction,
          reduction_reason: editReductionReason.trim(),
        })
      } else if (type === 'item-gift' && selectedItemId != null) {
        const giftQuantity = Number(editInput) || 0
        res = await axios.patch(`/api/order/${tableId}/item/${selectedItemId}`, {
          gift_quantity: giftQuantity,
          gift_reason: editGiftReason,
        })
      }
      if (res && res.data.success) {
        setOrder(res.data.data)
        setEditModal(null)
      } else if (res) {
        message.error(res.data.error || '更新失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新失败')
    }
  }

  const handleUpdateQuantity = (itemId: number, quantity: number) => {
    if (order?.status === 'pending') {
      updateQuantity(itemId, quantity)
      return
    }

    const item = orderItems.find(current => current.id === itemId)
    if (!item) return

    if (addingAfterSubmit) {
      if (!item.addition_pending) return
      updateQuantityDirect(itemId, quantity, { add_mode_change: true })
      return
    }

    if (quantity > item.quantity) {
      message.warning('请先点击加菜')
      return
    }

    requestAdjustmentReason(reason => updateQuantityWithReason(itemId, quantity, reason))
  }

  const startAddMode = () => {
    if (!canPerform('order.addition')) return
    setSelectedItemId(null)
    setAddingAfterSubmit(true)
  }

  const getAddedItems = () => {
    return orderItems.filter(item => item.addition_pending)
  }

  const printTicket = async (type = '补打', items?: OrderItem[]) => {
    try {
      const res = await axios.post(`/api/order/${tableId}/ticket`, { type, items })
      if (res.data.success) {
        setOrder(res.data.data.order)
        return true
      } else {
        message.error(res.data.error || '生成小票失败')
        return false
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '生成小票失败')
      return false
    }
  }

  const openReprintMode = () => {
    setSelectedItemId(null)
    setReprintQuantities({})
    setReprintMode(true)
  }

  const setReprintQuantity = (item: OrderItem, quantity: number) => {
    setReprintQuantities(current => ({
      ...current,
      [item.id]: Math.max(0, Math.min(item.quantity, quantity)),
    }))
  }

  const toggleReprintItem = (item: OrderItem) => {
    setReprintQuantity(item, reprintQuantities[item.id] ? 0 : item.quantity)
  }

  const confirmReprint = async () => {
    const items = orderItems
      .filter(item => !item.addition_pending && (reprintQuantities[item.id] || 0) > 0)
      .map(item => ({ ...item, quantity: reprintQuantities[item.id] }))
    if (!items.length) {
      message.warning('请选择需要补打的菜品')
      return
    }
    const printed = await printTicket('补打制作单', items)
    if (printed) {
      setReprintMode(false)
      setReprintQuantities({})
    }
  }

  const confirmAddMode = async () => {
    const addedItems = getAddedItems()
    if (!addedItems.length) {
      message.warning('没有新增菜品')
      return
    }

    const printed = await printTicket('加菜', addedItems)
    if (!printed) return

    setAddingAfterSubmit(false)
    onBack()
  }

  const cancelAddMode = async () => {
    try {
      const res = await axios.delete(`/api/order/${tableId}/additions`)
      if (!res.data.success) {
        message.error(res.data.error || '取消加菜失败')
        return
      }
      setAddingAfterSubmit(false)
      setSelectedItemId(null)
      setOrder(res.data.data)
    } catch (e: any) {
      message.error(e?.response?.data?.error || '取消加菜失败')
    }
  }

  const leaveOrderPage = () => {
    onBack()
  }

  const handleFinalize = async () => {
    setFinalizing(true)
    try {
      const res = await axios.post(`/api/order/${tableId}/checkout`, {})
      if (res.data.success) {
        setOrder(res.data.data)
        fetchTableInfo()
        try {
          const closeRes = await axios.post(`/api/table/${tableId}/close`)
          if (closeRes.data.success) {
            onBack()
          } else {
            message.error(closeRes.data.error || '清台失败')
          }
        } catch (e: any) {
          message.error(e?.response?.data?.error || '清台失败')
        }
      } else {
        message.error(res.data.error || '结账失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '结账失败')
    } finally {
      setFinalizing(false)
    }
  }

  const submitOrder = async () => {
    if (addingAfterSubmit) {
      confirmAddMode()
      return
    }

    try {
      const res = await axios.post(`/api/order/${tableId}/submit`)
      if (res.data.success) {
        setOrder(res.data.data)
        setAddingAfterSubmit(false)
        onBack()
      } else {
        message.error(res.data.error || '下单失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '下单失败')
    }
  }

  const clearTable = async () => {
    try {
      const res = await axios.post(`/api/table/${tableId}/close`)
      if (res.data.success) {
        onBack()
      } else {
        message.error(res.data.error || '清台失败')
      }
    } catch (e) {
      message.error('清台失败')
    }
  }

  const handleCancelOrder = () => {
    const withdrawingTable = !order || order.status === 'pending'
    Modal.confirm({
      title: withdrawingTable ? `撤销 ${tableId} 开台` : `取消 ${tableId} 当前订单`,
      content: withdrawingTable
        ? '撤台后会清空尚未下单的菜品，并将桌台恢复为空桌。'
        : '撤单后会清空当前订单并将桌台恢复为空桌。',
      okText: withdrawingTable ? '确认撤台' : '确认撤单',
      cancelText: '返回',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.post(`/api/order/${tableId}/cancel`)
          if (res.data.success) {
            onBack()
          } else {
            message.error(res.data.error || '取消订单失败')
          }
        } catch (e) {
          message.error('取消订单失败')
        }
      },
    })
  }

  const openGuestEditor = () => {
    if (!canPerform('table.edit_guests')) return
    setGuestInput(String(tableInfo.guests || 1))
    setGuestInputDirty(false)
    setGuestEditorVisible(true)
  }

  const appendGuestDigit = (digit: string) => {
    setGuestInput(current => {
      const next = !guestInputDirty || current === '0' ? digit : `${current}${digit}`
      return next.length > 2 ? current : next
    })
    setGuestInputDirty(true)
  }

  const backspaceGuestInput = () => {
    setGuestInput(current => current.length > 1 ? current.slice(0, -1) : '0')
    setGuestInputDirty(true)
  }

  const clearGuestInput = () => {
    setGuestInput('0')
    setGuestInputDirty(true)
  }

  const saveGuests = async () => {
    const guests = Number(guestInput)
    if (!Number.isInteger(guests) || guests < 1 || guests > 50) {
      message.error('请输入 1-50 的用餐人数')
      return
    }

    try {
      const res = await axios.put(`/api/table/${tableId}/guests`, { guests })
      if (res.data.success) {
        setTableInfo(res.data.data)
        setGuestEditorVisible(false)
      } else {
        message.error(res.data.error || '修改人数失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '修改人数失败')
    }
  }

  const currentItems = useMemo(() => {
    if (selectedCategory === -1) {
      return categories.flatMap(c => c.items)
    }
    return categories[selectedCategory]?.items || []
  }, [categories, selectedCategory])

  const totalItemCount = useMemo(
    () => categories.reduce((sum, c) => sum + (c.items?.length || 0), 0),
    [categories]
  )

  const orderItems = order?.items || []
  const pendingAdditionItems = orderItems.filter(item => item.addition_pending)
  const reprintableItems = orderItems.filter(item => !item.addition_pending && !item.returned)
  const allReprintItemsSelected = reprintableItems.length > 0 && reprintableItems.every(
    item => (reprintQuantities[item.id] || 0) === item.quantity
  )
  const totalQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0)
  const originalOrderTotal = orderItems.reduce(
    (sum, item) => sum + (item.returned ? 0 : item.price * item.quantity),
    0
  )
  const orderPayable = order?.checkout?.payable ?? order?.total ?? 0
  const hasOrderSavings = orderPayable < originalOrderTotal - 0.005
  const orderFinalized = order?.status === 'paid'
  const financialAdjustmentsLocked = (order?.checkout?.paid_total || 0) > 0.005 &&
    (order?.checkout?.balance_due || 0) <= 0.01
  const orderSubmitted = ['submitted', 'served'].includes(order?.status || '')
  const tableAwaitingOrder = !order || order.status === 'pending'
  const canCancelCurrentTable = !guestReadOnly && !orderFinalized && (
    Boolean(order) || Boolean(tableInfo.opened_at) || tableInfo.display_status === 'opened'
  )
  const checkoutMode = orderSubmitted && !addingAfterSubmit
  const menuLocked = guestReadOnly || orderFinalized || (orderSubmitted && !addingAfterSubmit)
  const selectedItem = orderItems.find(i => i.id === selectedItemId) || null
  const selectedItemUnavailable = !selectedItem || orderFinalized || (addingAfterSubmit && !selectedItem.addition_pending)
  const actionLabel = orderSubmitted
      ? '结账'
      : order?.status === 'paid'
        ? '清台'
        : '下单'

  useLayoutEffect(() => {
    if (reprintMode) {
      if (selectedItemId != null) setSelectedItemId(null)
      return
    }
    const selectableItems = addingAfterSubmit
      ? orderItems.filter(item => item.addition_pending)
      : orderItems.filter(item => !item.returned)
    if (selectableItems.length === 0) {
      if (selectedItemId != null) setSelectedItemId(null)
      return
    }
    const stillExists = selectableItems.some(i => i.id === selectedItemId)
    if (!stillExists) {
      setSelectedItemId(selectableItems[0].id)
    }
  }, [orderItems, selectedItemId, addingAfterSubmit, reprintMode])

  const handlePrimaryAction = () => {
    if (orderSubmitted) {
      handleFinalize()
      return
    }

    if (order?.status === 'paid') {
      clearTable()
      return
    }

    submitOrder()
  }

  const getItemQuantity = (itemId: number) => {
    return orderItems.reduce(
      (sum, item) => sum + ((item.menu_item_id ?? item.id) === itemId ? item.quantity : 0),
      0
    )
  }

  const getDuration = () => {
    if (!tableInfo.opened_at) return '0 分钟'
    const opened = new Date(tableInfo.opened_at.replace(' ', 'T'))
    const minutes = Math.max(0, Math.floor((Date.now() - opened.getTime()) / 60000))
    if (minutes < 60) return `${minutes} 分钟`
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
  }

  if (initialOrderLoading) {
    return (
      <main className="order-page order-page-loading" aria-label="正在加载订单">
        <div className="order-loading-top" />
        <div className="order-loading-workspace">
          <div className="order-loading-card">
            <i /><i /><i /><i />
          </div>
          <div className="order-loading-card order-loading-card-wide">
            <i /><i /><i /><i /><i /><i />
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={`order-page order-page-ready${checkoutMode ? ' checkout-mode' : ''}${addingAfterSubmit ? ' add-mode' : ''}`}>
      <div className="order-top-row">
        <div className="order-info-card">
          <Button icon={<ArrowLeftOutlined />} onClick={leaveOrderPage}>
            返回
          </Button>
          <div className="order-heading">
            <div className="order-title">桌台 {tableId}</div>
            <button
              className="order-meta order-guest-button"
              type="button"
              onClick={openGuestEditor}
              disabled={!canPerform('table.edit_guests')}
              title={guestReadOnly ? '访客不能修改既有订单' : canPerform('table.edit_guests') ? '点击修改人数' : '无修改人数权限'}
            >
              <EditOutlined />
              <span>{tableInfo.guests} 人</span>
              <em>·</em>
              <span>{getDuration()}</span>
            </button>
            {guestReadOnly && <span className="guest-readonly-badge">访客只读</span>}
          </div>
          {!orderFinalized && (addingAfterSubmit ? canPerform('order.addition') : canPerform('order.change_quantity')) && (
            (!orderSubmitted && orderItems.length > 0) ||
            (addingAfterSubmit && pendingAdditionItems.length > 0)
          ) && (
            <button
              type="button"
              className="clear-items-btn"
              onClick={clearAllItems}
            >
              清空
            </button>
          )}
        </div>
        {!(orderSubmitted && !addingAfterSubmit) && (
          <div className="category-card">
            <div className="category-tabs">
              <button
                className={selectedCategory === -1 ? 'category-tab active' : 'category-tab'}
                onClick={() => setSelectedCategory(-1)}
              >
                <span>全部</span>
                <b>{totalItemCount}</b>
              </button>
              {categories.map((category, index) => (
                <button
                  key={category.name}
                  className={selectedCategory === index ? 'category-tab active' : 'category-tab'}
                  onClick={() => setSelectedCategory(index)}
                >
                  <span>{category.name}</span>
                  <b>{category.items.length}</b>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <section className="order-workspace">
        <aside className={`bill-card${checkoutMode ? ' submitted' : ''}`}>
          <div className="bill-panel">
            {order?.remark && (
              <div className="bill-order-remark-card">
                <div className="bill-order-remark-head">
                  <ProfileOutlined />
                  <span>整单备注</span>
                </div>
                <p>{order.remark}</p>
              </div>
            )}
          <div className="bill-list">
            {orderItems.length === 0 && (
              <div className="empty-bill">还没有点单</div>
            )}
            {orderItems.map((item, index) => {
              if (reprintMode) {
                if (item.addition_pending || item.returned) return null
                const reprintQuantity = reprintQuantities[item.id] || 0
                return (
                  <div
                    key={item.id}
                    className={`bill-item reprint-item${reprintQuantity > 0 ? ' selected' : ''}`}
                    onClick={() => toggleReprintItem(item)}
                  >
                    <input
                      type="checkbox"
                      checked={reprintQuantity > 0}
                      onChange={() => toggleReprintItem(item)}
                      onClick={event => event.stopPropagation()}
                      aria-label={`选择补打 ${item.name}`}
                    />
                    <span className="bill-item-name-wrap">
                      <strong className="bill-item-name">{item.name}</strong>
                    </span>
                    <span className="reprint-original-qty">原数量 {item.quantity}</span>
                    <span className="reprint-qty-stepper" onClick={event => event.stopPropagation()}>
                      <button type="button" disabled={reprintQuantity <= 0} onClick={() => setReprintQuantity(item, reprintQuantity - 1)}>−</button>
                      <b>{reprintQuantity}</b>
                      <button type="button" disabled={reprintQuantity >= item.quantity} onClick={() => setReprintQuantity(item, reprintQuantity + 1)}>＋</button>
                    </span>
                  </div>
                )
              }
              const isLocked = guestReadOnly || orderFinalized || item.returned || (addingAfterSubmit && !item.addition_pending)
              const badge = formatItemBadge(item)
              const giftBadge = formatGiftBadge(item)
              const currentTotal = itemDisplayTotal(item)
              const originalTotal = item.price * item.quantity
              const hasDiscount = currentTotal < originalTotal - 0.005
              const showAdditionDivider = addingAfterSubmit && pendingAdditionItems.length > 0 &&
                !item.addition_pending && index === pendingAdditionItems.length
              return (
                <Fragment key={item.id}>
                {showAdditionDivider && <div className="bill-addition-divider"><span>已下单菜品</span></div>}
                <button
                  type="button"
                  className={`bill-item${selectedItemId === item.id ? ' selected' : ''}${isLocked ? ' locked' : ''}${item.returned ? ' returned' : ''}${item.addition_pending ? ' addition-pending' : ''}`}
                  disabled={isLocked}
                  onClick={() => setSelectedItemId(item.id === selectedItemId ? null : item.id)}
                >
                  <span className="bill-item-name-wrap">
                    <strong className="bill-item-name">
                      {item.name}
                      {item.returned && <span className="bill-item-return-flag" title={item.return_reason}>退</span>}
                      {item.remark && <em className="bill-item-remark">（{item.remark}）</em>}
                    </strong>
                    {giftBadge && <span className="bill-item-gift-flag">{giftBadge}</span>}
                    {badge && <span className="bill-item-flag">{badge}</span>}
                  </span>
                  <span className="bill-item-qty">{item.quantity}</span>
                  <span className="bill-item-price">
                    {item.returned ? (
                      <del className="bill-item-returned-price">¥{formatAmount(originalTotal)}</del>
                    ) : (
                      <>
                        <b className="bill-item-total">¥{formatAmount(currentTotal)}</b>
                        {hasDiscount && <del>¥{formatAmount(originalTotal)}</del>}
                      </>
                    )}
                  </span>
                </button>
                </Fragment>
              )
            })}
          </div>

          <div className="bill-footer">
            {reprintMode ? (
              <div className="bill-reprint-actions">
                <Button
                  size="large"
                  block
                  onClick={() => {
                    if (allReprintItemsSelected) {
                      setReprintQuantities({})
                    } else {
                      setReprintQuantities(reprintableItems.reduce<Record<number, number>>((result, item) => {
                        result[item.id] = item.quantity
                        return result
                      }, {}))
                    }
                  }}
                >
                  {allReprintItemsSelected ? '取消全选' : '全选'}
                </Button>
                <Button
                  type="primary"
                  size="large"
                  block
                  disabled={!Object.values(reprintQuantities).some(quantity => quantity > 0)}
                  onClick={confirmReprint}
                >
                  确认
                </Button>
              </div>
            ) : (
              <>
                <div className="total-row">
                  <div className="bill-total-count">
                    <span>当前账单</span>
                    <strong>共 {orderItems.length} 项 · {totalQuantity} 份</strong>
                  </div>
                  <div className="bill-total-amount">
                    <span>应收金额</span>
                    <strong>¥{orderPayable.toFixed(2)}</strong>
                    {hasOrderSavings && <del>¥{originalOrderTotal.toFixed(2)}</del>}
                  </div>
                </div>
                {addingAfterSubmit ? (
                  <div className="bill-action-row">
                    <Button size="large" block onClick={cancelAddMode}>取消</Button>
                    <Button type="primary" size="large" block disabled={!pendingAdditionItems.length || !canPerform('order.addition')} onClick={confirmAddMode}>下单</Button>
                  </div>
                ) : orderSubmitted ? (
                  canPerform('order.addition') && <Button size="large" block disabled={!orderItems.length} onClick={startAddMode}>加菜</Button>
                ) : (
                <Button
                  type="primary"
                  size="large"
                  block
                  disabled={!orderItems.length || !canPerform('order.submit')}
                  onClick={handlePrimaryAction}
                >
                  {actionLabel}
                </Button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="action-panel">
          {!checkoutMode && (addingAfterSubmit ? canPerform('order.addition') : canPerform('order.change_quantity')) && <div className="action-qty-block">
            <div className="action-qty-stepper">
              <Button
                shape="circle"
                icon={<MinusOutlined />}
                disabled={
                  selectedItemUnavailable
                }
                onClick={() => selectedItem && adjustSelectedItemQuantity(selectedItem.quantity - 1)}
              />
              <b>{selectedItem ? selectedItem.quantity : 0}</b>
              <Button
                shape="circle"
                icon={<PlusOutlined />}
                disabled={selectedItemUnavailable || (orderSubmitted && !addingAfterSubmit)}
                onClick={() => selectedItem && adjustSelectedItemQuantity(selectedItem.quantity + 1)}
              />
            </div>
          </div>}
          {!checkoutMode && canPerform('order.add_item') && <button
            type="button"
            className="action-button"
            disabled={selectedItemUnavailable}
            onClick={openItemRemark}
          >
            <FileTextOutlined /> 菜品备注
          </button>}
          {canPerform('order.discount') && <button
            type="button"
            className={`action-button${selectedItem?.discount ? ' danger' : ''}`}
            disabled={selectedItemUnavailable || financialAdjustmentsLocked}
            onClick={selectedItem?.discount ? clearDiscount : openItemDiscount}
          >
            <TagOutlined /> {selectedItem?.discount ? '取消折扣' : '菜品打折'}
          </button>}
          {canPerform('order.reduction') && <button
            type="button"
            className={`action-button${selectedItem?.reduction ? ' danger' : ''}`}
            disabled={selectedItemUnavailable || financialAdjustmentsLocked}
            onClick={selectedItem?.reduction ? clearReduction : openItemReduction}
          >
            <MinusCircleOutlined /> {selectedItem?.reduction ? '取消减免' : '菜品减免'}
          </button>}
          {!checkoutMode && (addingAfterSubmit ? canPerform('order.addition') : canPerform('order.change_quantity')) && <button
            type="button"
            className="action-button"
            disabled={selectedItemUnavailable}
            onClick={() => removeSelectedItem()}
          >
            <DeleteOutlined /> 删除
          </button>}
          {canPerform('order.return') && <button
            type="button"
            className="action-button"
            disabled={selectedItemUnavailable || financialAdjustmentsLocked || !orderSubmitted || addingAfterSubmit}
            onClick={returnSelectedItem}
          >
            <RollbackOutlined /> 退菜
          </button>}
          {canPerform('order.gift') && <button
            type="button"
            className={`action-button${selectedItem?.gift_quantity ? ' danger' : ''}`}
            disabled={selectedItemUnavailable || financialAdjustmentsLocked}
            onClick={selectedItem?.gift_quantity ? clearGift : openItemGift}
          >
            <GiftOutlined /> {selectedItem?.gift_quantity ? '取消赠菜' : '赠菜'}
          </button>}
          {canPerform('order.add_item') && <button
            type="button"
            className="action-button"
            disabled={!order || orderFinalized}
            onClick={openOrderRemark}
          >
            <ProfileOutlined /> 整单备注
          </button>}
          {canPerform('table.transfer') && <button
            type="button"
            className="action-button"
            disabled={!orderItems.length || orderFinalized}
            onClick={() => onRequestTableAction?.('transfer', tableId)}
          >
            <SwapOutlined /> 转台
          </button>}
          {canPerform('table.merge') && <button
            type="button"
            className="action-button"
            disabled={!orderItems.length || orderFinalized}
            onClick={() => onRequestTableAction?.('merge', tableId)}
          >
            <RetweetOutlined /> 并台
          </button>}
          {canPerform('order.cancel') && <button
            type="button"
            className="action-button danger"
            disabled={!canCancelCurrentTable}
            onClick={handleCancelOrder}
          >
            <StopOutlined /> {tableAwaitingOrder ? '撤台' : '撤单'}
          </button>}
          {productionTicketEnabled && canPerform('ticket.reprint') && <button
            type="button"
            className={`action-button${reprintMode ? ' danger' : ''}`}
            disabled={!orderSubmitted || !reprintableItems.length || addingAfterSubmit}
            onClick={() => reprintMode ? setReprintMode(false) : openReprintMode()}
          >
            <PrinterOutlined /> {reprintMode ? '退出补打' : '补打制作单'}
          </button>}
        </div>
        </aside>

        {orderSubmitted && !addingAfterSubmit ? (
          <section className="menu-panel checkout-panel-wrap">
            <CheckoutPanel order={order!} onUpdated={fetchOrder} onFinalize={handleFinalize} finalizing={finalizing} readOnly={guestReadOnly} />
          </section>
        ) : (
        <section className="menu-panel">
          <div className="menu-grid">
            {currentItems.map(item => {
              const quantity = getItemQuantity(item.id)
              const menuName = parseMenuName(item.name)
              return (
                <button
                  key={item.id}
                  className={`${quantity > 0 ? 'menu-card has-count' : 'menu-card'}${menuLocked ? ' locked' : ''}`}
                  disabled={menuLocked || !canPerform('order.add_item') || (addingAfterSubmit && !canPerform('order.addition'))}
                  onClick={() => addItem(item)}
                >
                  {quantity > 0 && <span className="menu-count">{quantity}</span>}
                  <span className="menu-name">{menuName.title}</span>
                  {item.english_name && <span className="menu-en">{item.english_name}</span>}
                  <span className="menu-bottom">
                    <b>¥{formatAmount(item.price)}</b>
                    {(menuName.unit || item.abv) && (
                      <em className={menuName.unit ? 'menu-unit' : undefined}>
                        {menuName.unit || item.abv}
                      </em>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
        )}
      </section>

      <Modal
        title={`修改人数 · ${tableId}`}
        open={guestEditorVisible}
        onCancel={() => setGuestEditorVisible(false)}
        onOk={saveGuests}
        okText="确认修改"
        cancelText="取消"
        width={420}
        rootClassName="guest-editor-modal"
      >
        <div className="guest-editor">
          <div className="guest-editor-display">
            <span>当前输入</span>
            <strong>{guestInput || '0'}<em>人</em></strong>
          </div>
          <div className="guest-editor-section">
            <span className="guest-editor-label">常用人数</span>
            <div className="guest-quick-options">
              {[1, 2, 3, 4, 6, 8].map(value => (
                <button
                  key={value}
                  type="button"
                  className={guestInput === String(value) ? 'active' : ''}
                  onClick={() => {
                    setGuestInput(String(value))
                    setGuestInputDirty(true)
                  }}
                >
                  {value} 人
                </button>
              ))}
            </div>
          </div>
          <div className="guest-editor-section">
            <span className="guest-editor-label">数字键盘</span>
            <div className="guest-editor-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(value => (
              <button key={value} type="button" onClick={() => appendGuestDigit(value)}>
                {value}
              </button>
            ))}
            <button type="button" className="keypad-action" onClick={clearGuestInput}>
              清除
            </button>
            <button type="button" onClick={() => appendGuestDigit('0')}>
              0
            </button>
            <button
              type="button"
              className="keypad-action keypad-icon"
              aria-label="退格"
              onClick={backspaceGuestInput}
            >
              <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true">
                <path d="M9 2H25V18H9L2 10L9 2Z" />
                <path d="M13 7L19 13M19 7L13 13" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        title={
          editModal?.type === 'item-remark' ? `菜品备注 · ${selectedItem?.name || ''}`
          : editModal?.type === 'order-remark' ? '整单备注'
          : editModal?.type === 'item-discount' ? `菜品打折 · ${selectedItem?.name || ''}`
          : editModal?.type === 'item-reduction' ? `菜品减免 · ${selectedItem?.name || ''}`
          : editModal?.type === 'item-gift' ? `赠菜 · ${selectedItem?.name || ''}`
          : ''
        }
        open={editModal !== null}
        onCancel={() => setEditModal(null)}
        onOk={submitEdit}
        okText="确认"
        cancelText="取消"
        destroyOnClose
        footer={
          editModal?.type === 'item-discount' || editModal?.type === 'item-reduction' ? null : undefined
        }
      >
        {editModal?.type === 'item-remark' && (
          <div className="item-remark-editor">
            <span className="item-remark-label">快捷备注</span>
            <div className="item-remark-options" role="group" aria-label="快捷备注">
              {['去冰', '要冰', '不要冰'].map(option => (
                <button
                  key={option}
                  type="button"
                  className={editInput === option ? 'active' : ''}
                  onClick={() => setEditInput(current => current === option ? '' : option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <span className="item-remark-label">自定义备注</span>
            <Input.TextArea
              value={editInput}
              onChange={e => setEditInput(e.target.value)}
              placeholder="如：不要香菜、单独装"
              allowClear
              maxLength={50}
              autoSize={{ minRows: 2, maxRows: 4 }}
              showCount
            />
          </div>
        )}
        {editModal?.type === 'order-remark' && (
          <Input.TextArea
            value={editInput}
            onChange={e => setEditInput(e.target.value)}
            placeholder="如：客人赶时间、VIP 客户、老客户"
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={200}
          />
        )}
        {editModal?.type === 'item-discount' && (
          <div className="discount-form">
            <div className="discount-input-row">
              <div className="discount-input-wrap">
                <input
                  className="discount-input"
                  type="text"
                  inputMode="numeric"
                  value={editInput}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^\d]/g, '')
                    if (raw === '') { setEditInput(''); return }
                    const n = Math.max(0, Math.min(100, Number(raw)))
                    setEditInput(String(n))
                  }}
                  placeholder="如 80"
                />
                <span className="discount-input-suffix">%</span>
              </div>
            </div>
            <div className="discount-quick-chips">
              {[50, 60, 80, 85, 88].map(v => (
                <button
                  key={v}
                  type="button"
                  className={`discount-chip${editInput === String(v) ? ' active' : ''}`}
                  onClick={() => setEditInput(String(v))}
                >
                  {v}%
                </button>
              ))}
            </div>
            <div className="discount-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => (
                <button key={k} type="button" className="discount-key" onClick={() => {
                  const cur = editInput === '' ? 0 : Number(editInput)
                  const next = cur * 10 + Number(k)
                  setEditInput(String(Math.max(0, Math.min(100, next))))
                }}>
                  {k}
                </button>
              ))}
              <button type="button" className="discount-key aux" onClick={() => setEditInput('0')}>清空</button>
              <button type="button" className="discount-key" onClick={() => {
                const cur = editInput === '' ? 0 : Number(editInput)
                const next = cur * 10
                setEditInput(String(Math.max(0, Math.min(100, next))))
              }}>0</button>
              <button type="button" className="discount-key aux" onClick={() => {
                const cur = editInput === '' ? 0 : Number(editInput)
                setEditInput(String(Math.floor(cur / 10)))
              }} aria-label="退格">
                <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true">
                  <path d="M9 2H25V18H9L2 10L9 2Z" />
                  <path d="M13 7L19 13M19 7L13 13" />
                </svg>
              </button>
            </div>
            <div className="discount-reason-row">
              <input
                className="discount-reason-input"
                type="text"
                value={editDiscountReason}
                onChange={e => setEditDiscountReason(e.target.value)}
                placeholder="打折原因（可选）"
                maxLength={50}
              />
            </div>
            <button
              type="button"
              className="discount-confirm-btn"
              onClick={submitEdit}
            >
              确认
            </button>
          </div>
        )}
        {editModal?.type === 'item-gift' && selectedItem && (
          <div className="edit-number-form">
            <div className="edit-number-hint">
              当前数量 {selectedItem.quantity} 份，单价 ¥{formatAmount(selectedItem.price)}。
              选择赠菜数量后，对应份数免费，其余按原价计算。
            </div>
            <div className="gift-qty-row">
              <span>赠菜数量</span>
              <div className="gift-qty-stepper">
                <button
                  type="button"
                  className="gift-qty-btn"
                  disabled={Number(editInput) <= 0}
                  onClick={() => setEditInput(String(Math.max(0, (Number(editInput) || 0) - 1)))}
                  aria-label="减少"
                >
                  <MinusOutlined />
                </button>
                <b className="gift-qty-value">{Number(editInput) || 0}</b>
                <button
                  type="button"
                  className="gift-qty-btn"
                  disabled={Number(editInput) >= selectedItem.quantity}
                  onClick={() => setEditInput(String(Math.min(selectedItem.quantity, (Number(editInput) || 0) + 1)))}
                  aria-label="增加"
                >
                  <PlusOutlined />
                </button>
              </div>
            </div>
            <div className="gift-reason-row">
              <span>赠菜原因</span>
              <Radio.Group
                className="adjust-reason-group"
                value={editGiftReason}
                onChange={e => setEditGiftReason(e.target.value)}
              >
                <Radio value="生日礼">生日礼</Radio>
                <Radio value="老顾客">老顾客</Radio>
                <Radio value="客诉补偿">客诉补偿</Radio>
                <Radio value="经理赠送">经理赠送</Radio>
                <Radio value="其他">其他</Radio>
              </Radio.Group>
            </div>
          </div>
        )}
        {editModal?.type === 'item-reduction' && (() => {
          const lineMax = (selectedItem?.price || 0) * (selectedItem?.quantity || 0)
          const pressKey = (key: string) => {
            setEditInput(current => {
              const cur = current === '' ? '0' : current
              if (key === 'clear') return '0'
              if (key === 'backspace') {
                if (cur.length <= 1) return '0'
                return cur.slice(0, -1)
              }
              if (key === '.') {
                if (cur.includes('.')) return cur
                return `${cur}.`
              }
              const digit = key
              const next = cur === '0' ? digit : `${cur}${digit}`
              const num = Number(next)
              if (Number.isNaN(num) || num > lineMax) return cur
              return next
            })
          }
          const quickValues = (() => {
            if (lineMax <= 0) return []
            const steps = [5, 10, 20, 50]
            const out: number[] = []
            for (const s of steps) {
              if (s < lineMax) out.push(s)
            }
            if (!out.includes(Math.floor(lineMax / 2))) out.push(Math.floor(lineMax / 2))
            if (!out.includes(lineMax)) out.push(lineMax)
            return Array.from(new Set(out)).sort((a, b) => a - b).slice(0, 5)
          })()
          return (
            <div className="discount-form">
              <div className="discount-input-row">
                <div className="discount-input-wrap has-prefix">
                  <span className="discount-input-prefix">¥</span>
                  <input
                    className="discount-input"
                    type="text"
                    inputMode="decimal"
                    value={editInput}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^\d.]/g, '')
                      if (raw === '') { setEditInput(''); return }
                      const num = Number(raw)
                      if (Number.isNaN(num)) return
                      if (num > lineMax) return
                      setEditInput(raw)
                    }}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="edit-number-hint">
                本菜品总额 ¥{formatAmount(lineMax)}，减免不能超过该金额
              </div>
              {quickValues.length > 0 && (
                <div className="discount-quick-chips">
                  {quickValues.map(v => (
                    <button
                      key={v}
                      type="button"
                      className={`discount-chip${editInput === String(v) ? ' active' : ''}`}
                      onClick={() => setEditInput(String(v))}
                    >
                      ¥{formatAmount(v)}
                    </button>
                  ))}
                </div>
              )}
              <div className="discount-keypad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => (
                  <button key={k} type="button" className="discount-key" onClick={() => pressKey(k)}>
                    {k}
                  </button>
                ))}
                <button type="button" className="discount-key aux" onClick={() => pressKey('.')}>.</button>
                <button type="button" className="discount-key" onClick={() => pressKey('0')}>0</button>
                <button type="button" className="discount-key aux" onClick={() => pressKey('backspace')} aria-label="退格">
                  <svg className="backspace-icon" viewBox="0 0 28 20" aria-hidden="true">
                    <path d="M9 2H25V18H9L2 10L9 2Z" />
                    <path d="M13 7L19 13M19 7L13 13" />
                  </svg>
                </button>
              </div>
              <div className="discount-reason-row">
                <input
                  className="discount-reason-input"
                  type="text"
                  value={editReductionReason}
                  onChange={e => setEditReductionReason(e.target.value)}
                  placeholder="减免原因（可选）"
                  maxLength={50}
                />
              </div>
              <button
                type="button"
                className="discount-confirm-btn"
                onClick={submitEdit}
              >
                确认
              </button>
            </div>
          )
        })()}
      </Modal>
    </main>
  )
}

export default OrderPage
