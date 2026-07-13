import { useEffect, useMemo, useState } from 'react'
import { Button, DatePicker, Input, Modal, Select, Table, Tag, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DownloadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import axios from 'axios'
import dayjs from 'dayjs'
import { useAuth } from '../auth/AuthContext'
import SettingsTableFrame from './SettingsTableFrame'


const { RangePicker } = DatePicker

interface AuditLogRecord {
  id: string
  created_at: string
  user_id?: string | null
  user_name?: string | null
  roles: string[]
  ip_address?: string | null
  user_agent?: string | null
  module: string
  action: string
  resource_type?: string | null
  resource_id?: string | null
  before?: unknown
  after?: unknown
  reason?: string | null
  approver_user_id?: string | null
  result: string
  error_code?: string | null
}

const MODULE_LABELS: Record<string, string> = {
  auth: '登录与会话',
  user: '用户管理',
  role: '角色权限',
  audit: '系统日志',
}

function formatTime(value: string) {
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}

function formatSnapshot(value: unknown) {
  if (value === null || value === undefined) return '无'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export default function SystemLogPanel() {
  const { hasPermission } = useAuth()
  const [records, setRecords] = useState<AuditLogRecord[]>([])
  const [modules, setModules] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [selected, setSelected] = useState<AuditLogRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const filterParams = useMemo(() => ({
    keyword: keyword || undefined,
    module: moduleFilter || undefined,
    result: resultFilter || undefined,
    date_from: dateRange?.[0].startOf('day').format('YYYY-MM-DD HH:mm:ss'),
    date_to: dateRange?.[1].endOf('day').format('YYYY-MM-DD HH:mm:ss'),
  }), [keyword, moduleFilter, resultFilter, dateRange])

  useEffect(() => {
    setLoading(true)
    axios.get('/api/audit-logs', { params: { ...filterParams, page, page_size: pageSize } })
      .then(response => {
        setRecords(response.data.data)
        setTotal(response.data.total)
        setModules(response.data.modules || [])
      })
      .catch((error: any) => message.error(error?.response?.data?.error || '获取系统日志失败'))
      .finally(() => setLoading(false))
  }, [filterParams, page, pageSize, refreshKey])

  const exportLogs = async () => {
    setExporting(true)
    try {
      const response = await axios.post('/api/audit-logs/export', filterParams, { responseType: 'blob' })
      const disposition = String(response.headers['content-disposition'] || '')
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const filename = encodedName ? decodeURIComponent(encodedName) : `silver-lining-system-logs-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`
      const url = URL.createObjectURL(response.data)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(url)
      message.success('系统日志已导出')
      setRefreshKey(value => value + 1)
    } catch (error: any) {
      message.error(error?.response?.data?.error || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const columns: ColumnsType<AuditLogRecord> = [
    { title: '序号', key: 'sequence', width: 68, align: 'center', render: (_, __, index) => (page - 1) * pageSize + index + 1 },
    { title: '时间', dataIndex: 'created_at', width: 168, render: formatTime },
    { title: '操作人', dataIndex: 'user_name', width: 120, render: value => value || '匿名/系统' },
    { title: '模块', dataIndex: 'module', width: 120, render: value => MODULE_LABELS[value] || value },
    { title: '动作', dataIndex: 'action', width: 190 },
    {
      title: '业务对象',
      key: 'resource',
      width: 180,
      render: (_, record) => {
        const value = record.resource_type
          ? `${record.resource_type}${record.resource_id ? ` · ${record.resource_id}` : ''}`
          : '—'
        return (
          <Tooltip title={value} mouseEnterDelay={0.25} placement="topLeft">
            <span className="system-log-resource-cell">{value}</span>
          </Tooltip>
        )
      },
    },
    { title: 'IP/终端', dataIndex: 'ip_address', width: 132, render: value => value || '—' },
    { title: '结果', dataIndex: 'result', width: 88, align: 'center', render: value => <Tag color={value === 'success' ? 'green' : 'red'}>{value === 'success' ? '成功' : '失败'}</Tag> },
    { title: '操作', key: 'action_view', width: 82, fixed: 'right', render: (_, record) => <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setSelected(record)}>详情</Button> },
  ]

  return (
    <div className="system-log-panel">
      <div className="system-log-toolbar">
        <Input.Search
          value={keywordInput}
          allowClear
          placeholder="操作人 / 动作 / 对象 / 原因"
          onChange={event => setKeywordInput(event.target.value)}
          onSearch={value => { setKeyword(value.trim()); setPage(1) }}
        />
        <RangePicker value={dateRange} onChange={value => { setDateRange(value as [dayjs.Dayjs, dayjs.Dayjs] | null); setPage(1) }} />
        <Select
          value={moduleFilter}
          onChange={value => { setModuleFilter(value); setPage(1) }}
          options={[{ value: '', label: '全部模块' }, ...modules.map(value => ({ value, label: MODULE_LABELS[value] || value }))]}
        />
        <Select
          value={resultFilter}
          onChange={value => { setResultFilter(value); setPage(1) }}
          options={[{ value: '', label: '全部结果' }, { value: 'success', label: '成功' }, { value: 'failed', label: '失败' }]}
        />
        <div className="system-log-actions">
          <Button icon={<ReloadOutlined />} onClick={() => setRefreshKey(value => value + 1)}>刷新</Button>
          {hasPermission('audit.export') && <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={exportLogs}>导出日志</Button>}
        </div>
      </div>
      <SettingsTableFrame
        total={total}
        unit="条日志"
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      >
        {bodyHeight => (
          <Table
            className="pos-table settings-data-table system-log-table"
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={records}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: 1180, y: bodyHeight }}
          />
        )}
      </SettingsTableFrame>

      <Modal title="系统日志详情" open={selected !== null} onCancel={() => setSelected(null)} footer={<Button onClick={() => setSelected(null)}>关闭</Button>} width={760} destroyOnClose>
        {selected && (
          <div className="system-log-detail">
            <div className="system-log-detail-grid">
              <span><em>日志时间</em><strong>{formatTime(selected.created_at)}</strong></span>
              <span><em>操作人</em><strong>{selected.user_name || '匿名/系统'}</strong></span>
              <span><em>角色快照</em><strong>{selected.roles.join(' / ') || '—'}</strong></span>
              <span><em>模块 / 动作</em><strong>{MODULE_LABELS[selected.module] || selected.module} · {selected.action}</strong></span>
              <span><em>业务对象</em><strong>{selected.resource_type || '—'} {selected.resource_id || ''}</strong></span>
              <span><em>IP 地址</em><strong>{selected.ip_address || '—'}</strong></span>
              <span><em>执行结果</em><strong>{selected.result === 'success' ? '成功' : `失败 · ${selected.error_code || '未提供错误码'}`}</strong></span>
              <span><em>业务原因</em><strong>{selected.reason || '—'}</strong></span>
            </div>
            <div className="system-log-snapshot"><strong>变更前</strong><pre>{formatSnapshot(selected.before)}</pre></div>
            <div className="system-log-snapshot"><strong>变更后</strong><pre>{formatSnapshot(selected.after)}</pre></div>
            <div className="system-log-agent"><strong>终端信息</strong><span>{selected.user_agent || '—'}</span></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
