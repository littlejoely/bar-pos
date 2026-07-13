import { useLayoutEffect, useRef, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { Select } from 'antd'


const getPageItems = (page: number, totalPages: number): Array<number | string> => {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 3) return [1, 2, 3, 'more-right', totalPages]
  if (page >= totalPages - 2) return [1, 'more-left', totalPages - 2, totalPages - 1, totalPages]
  return [1, 'more-left', page, 'more-right', totalPages]
}

interface SettingsTableFrameProps {
  total: number
  unit: string
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  children: (bodyHeight: number) => ReactNode
}

const SettingsTableFrame: FC<SettingsTableFrameProps> = ({
  total,
  unit,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  children,
}) => {
  const frameRef = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState(260)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = getPageItems(page, totalPages)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const updateHeight = () => setBodyHeight(Math.max(140, frame.clientHeight - 102))
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="settings-table-frame" ref={frameRef}>
      {children(bodyHeight)}
      <div className="settings-table-pagination-footer">
        <span className="table-record-total">共 <b>{total}</b> {unit}</span>
        <div className="history-pagination-controls">
          <button
            type="button"
            className="history-page-arrow"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            aria-label="上一页"
          >‹</button>
          <div className="history-page-number-slots">
            {pageItems.map(item => typeof item === 'number' ? (
              <button
                key={item}
                type="button"
                className={page === item ? 'active' : ''}
                onClick={() => onPageChange(item)}
              >{item}</button>
            ) : <span key={item}>•••</span>)}
          </div>
          <button
            type="button"
            className="history-page-arrow"
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            aria-label="下一页"
          >›</button>
          <Select
            className="history-page-size-selector"
            value={pageSize}
            showSearch={false}
            popupMatchSelectWidth={false}
            options={[10, 20, 50, 100].map(size => ({ value: size, label: `${size} 条/页` }))}
            onChange={size => onPageSizeChange(size)}
          />
        </div>
      </div>
    </div>
  )
}

export default SettingsTableFrame
