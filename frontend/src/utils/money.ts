export const formatAmount = (value: unknown): string => {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

export const formatMoney = (value: unknown): string => `¥${formatAmount(value)}`
