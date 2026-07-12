import { useEffect, useState } from 'react'
import type { FC } from 'react'

interface StepperInputProps {
  value?: number | null
  onChange?: (v: number | null) => void
  min?: number
  max?: number
  step?: number
  precision?: number
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

const StepperInput: FC<StepperInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  placeholder,
  disabled,
  style,
  className,
}) => {
  const stringify = (numberValue: number) => (
    typeof precision === 'number' ? numberValue.toFixed(precision) : String(numberValue)
  )
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState(() => (
    typeof value === 'number' && Number.isFinite(value) ? stringify(value) : ''
  ))

  useEffect(() => {
    if (!focused) {
      setDraft(typeof value === 'number' && Number.isFinite(value) ? stringify(value) : '')
    }
  }, [value, precision, focused])

  const clamp = (n: number): number | null => {
    if (!Number.isFinite(n)) return null
    let v = n
    if (typeof min === 'number') v = Math.max(min, v)
    if (typeof max === 'number') v = Math.min(max, v)
    if (typeof precision === 'number') {
      const factor = 10 ** precision
      v = Math.round(v * factor) / factor
    }
    return v
  }
  const draftNumber = Number(draft)
  const current = Number.isFinite(draftNumber) && draft !== ''
    ? draftNumber
    : (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const stepBy = (delta: number) => {
    if (disabled) return
    const next = clamp(current + delta * step)
    if (next != null) {
      setDraft(stringify(next))
      onChange?.(next)
    }
  }
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const decimalPattern = typeof precision === 'number'
      ? new RegExp(`^-?\\d*(?:\\.\\d{0,${precision}})?$`)
      : /^-?\d*$/
    if (!decimalPattern.test(raw)) return
    setDraft(raw)
    if (raw === '') {
      onChange?.(null)
      return
    }
    const n = Number(raw)
    if (Number.isNaN(n)) return
    const clamped = clamp(n)
    if (clamped != null) onChange?.(clamped)
  }
  const normalizeDraft = () => {
    setFocused(false)
    if (draft === '' || draft === '-' || draft === '.') {
      setDraft('')
      onChange?.(null)
      return
    }
    const next = clamp(Number(draft))
    if (next != null) {
      setDraft(stringify(next))
      onChange?.(next)
    }
  }
  const atMin = typeof min === 'number' && current <= min
  const atMax = typeof max === 'number' && current >= max
  return (
    <span className={`seq-input${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`} style={style}>
      <input
        className="seq-input-field"
        type="text"
        inputMode={typeof precision === 'number' ? 'decimal' : 'numeric'}
        value={draft}
        onChange={handleInput}
        onFocus={() => setFocused(true)}
        onBlur={normalizeDraft}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            stepBy(-1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            stepBy(1)
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
      />
      <span className="seq-input-controls">
        <button
          type="button"
          className="seq-input-btn"
          onClick={() => stepBy(-1)}
          disabled={disabled || atMin}
          aria-label="减少"
          tabIndex={-1}
        >
          −
        </button>
        <button
          type="button"
          className="seq-input-btn"
          onClick={() => stepBy(1)}
          disabled={disabled || atMax}
          aria-label="增加"
          tabIndex={-1}
        >
          +
        </button>
      </span>
    </span>
  )
}

export default StepperInput
