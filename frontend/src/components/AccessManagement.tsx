import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Checkbox, Form, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, EditOutlined, KeyOutlined, LockOutlined, LogoutOutlined, PlusOutlined } from '@ant-design/icons'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import SettingsTableFrame from './SettingsTableFrame'


interface RoleRecord {
  id: number
  code: string
  name: string
  description: string
  is_system: boolean
  default_view: string
  user_count: number
  permissions: string[]
  created_by_user_id?: string | null
}

interface UserRecord {
  id: string
  username: string
  employee_no: string
  short_account: string
  display_name: string
  phone?: string | null
  status: 'active' | 'disabled' | 'password_change_required'
  roles: RoleRecord[]
  last_login_at?: string | null
  last_action_at?: string | null
  locked_until?: string | null
  created_at?: string | null
  created_by_user_id?: string | null
}

interface SessionRecord {
  id: string
  login_method: string
  ip_address?: string | null
  user_agent?: string | null
  created_at: string
  last_activity_at: string
  expires_at: string
  locked: boolean
  active: boolean
}

interface PermissionRecord {
  code: string
  module: string
  action: string
  description: string
}

const STATUS_META = {
  active: { label: '启用', color: 'green' },
  disabled: { label: '已停用', color: 'default' },
  password_change_required: { label: '待修改密码', color: 'orange' },
}

function GuestActionHint({ guest, children }: { guest: boolean; children: ReactNode }) {
  if (!guest) return <>{children}</>
  return <Tooltip title="访客用户不可操作"><span className="guest-disabled-action">{children}</span></Tooltip>
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function UserManagementPanel() {
  const { user: currentUser, session: currentSession, hasPermission, refresh } = useAuth()
  const currentIsSuperadmin = Boolean(currentUser?.roles.some(role => role.code === 'superadmin'))
  const isGuest = Boolean(currentUser?.roles.some(role => role.code === 'guest'))
  const [users, setUsers] = useState<UserRecord[]>([])
  const [roles, setRoles] = useState<RoleRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<UserRecord | null>(null)
  const [resetting, setResetting] = useState<UserRecord | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [resetCredentialType, setResetCredentialType] = useState<'password' | 'short_password'>('password')
  const [submitting, setSubmitting] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sessionUser, setSessionUser] = useState<UserRecord | null>(null)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [form] = Form.useForm()
  const [resetForm] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [userResponse, roleResponse] = await Promise.all([
        axios.get('/api/users'),
        hasPermission('role.view')
          ? axios.get('/api/roles')
          : Promise.resolve({ data: { data: [] } }),
      ])
      setUsers(userResponse.data.data)
      setRoles(roleResponse.data.data)
    } catch (error: any) {
      message.error(error?.response?.data?.error || '获取用户数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    const defaultRole = (isGuest ? roles.find(role => role.code === 'guest') : roles.find(role => role.code === 'waiter'))
      || roles.find(role => role.code !== 'superadmin')
    form.setFieldsValue({ role_codes: defaultRole ? [defaultRole.code] : [] })
    setModalOpen(true)
  }

  const openEdit = (record: UserRecord) => {
    setEditing(record)
    form.setFieldsValue({
      display_name: record.display_name,
      username: record.username,
      employee_no: record.employee_no,
      short_account: record.short_account,
      phone: record.phone,
      role_codes: record.roles.map(role => role.code),
    })
    setModalOpen(true)
  }

  const submit = async (values: Record<string, unknown>) => {
    setSubmitting(true)
    try {
      const payload = { ...values }
      if (editing && !hasPermission('role.assign')) delete payload.role_codes
      if (editing) await axios.patch(`/api/users/${editing.id}`, payload)
      else await axios.post('/api/users', payload)
      message.success(editing ? '用户资料已更新' : '用户已创建')
      setModalOpen(false)
      await load()
      if (editing?.id === currentUser?.id) await refresh()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleStatus = async (record: UserRecord) => {
    const status = record.status === 'disabled' ? 'active' : 'disabled'
    try {
      await axios.post(`/api/users/${record.id}/status`, { status })
      message.success(status === 'active' ? '用户已启用' : '用户已停用')
      await load()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '操作失败')
    }
  }

  const deleteUser = async (record: UserRecord) => {
    setDeletingUserId(record.id)
    try {
      await axios.delete(`/api/users/${record.id}`)
      message.success(`用户“${record.display_name}”已删除`)
      await load()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '删除用户失败')
    } finally {
      setDeletingUserId(null)
    }
  }

  const unlockUser = async (record: UserRecord) => {
    try {
      await axios.post(`/api/users/${record.id}/unlock`)
      message.success(`用户“${record.display_name}”已解锁`)
      await load()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '解锁失败')
    }
  }

  const loadSessions = async (record: UserRecord) => {
    setSessionUser(record)
    setSessionsLoading(true)
    try {
      const response = await axios.get(`/api/users/${record.id}/sessions`)
      setSessions(response.data.data || [])
    } catch (error: any) {
      message.error(error?.response?.data?.error || '获取会话失败')
      setSessionUser(null)
    } finally {
      setSessionsLoading(false)
    }
  }

  const revokeSession = async (record: SessionRecord) => {
    if (!sessionUser) return
    try {
      await axios.delete(`/api/users/${sessionUser.id}/sessions/${record.id}`)
      message.success('会话已下线')
      await loadSessions(sessionUser)
    } catch (error: any) {
      message.error(error?.response?.data?.error || '下线失败')
    }
  }

  const submitReset = async (values: { password?: string; short_password?: string }) => {
    if (!resetting) return
    setSubmitting(true)
    try {
      await axios.post(`/api/users/${resetting.id}/reset-credentials`, values)
      message.success(resetCredentialType === 'password'
        ? '账号密码已重置，该用户下次登录需要修改临时密码'
        : '短密码已重置')
      setResetting(null)
      resetForm.resetFields()
      await load()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '重置失败')
    } finally {
      setSubmitting(false)
    }
  }

  const filteredUsers = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    const visibleUsers = currentIsSuperadmin
      ? users
      : users.filter(item => !item.roles.some(role => role.code === 'superadmin'))
    return visibleUsers.filter(item => {
      if (roleFilter !== 'all' && !item.roles.some(role => role.code === roleFilter)) return false
      const locked = Boolean(item.locked_until && new Date(item.locked_until).getTime() > Date.now())
      if (statusFilter === 'locked' && !locked) return false
      if (statusFilter !== 'all' && statusFilter !== 'locked' && item.status !== statusFilter) return false
      return !normalized || [item.display_name, item.username, item.employee_no, item.short_account, item.phone || '']
        .some(value => value.toLowerCase().includes(normalized))
    })
  }, [users, keyword, roleFilter, statusFilter, currentIsSuperadmin])

  const pagedUsers = useMemo(
    () => filteredUsers.slice((page - 1) * pageSize, page * pageSize),
    [filteredUsers, page, pageSize],
  )
  const roleFilterOptions = useMemo(() => {
    const catalog = new Map<string, string>()
    roles.forEach(role => catalog.set(role.code, role.name))
    users.forEach(item => item.roles.forEach(role => catalog.set(role.code, role.name)))
    if (!currentIsSuperadmin) catalog.delete('superadmin')
    return Array.from(catalog, ([value, label]) => ({ value, label }))
  }, [roles, users, currentIsSuperadmin])

  useEffect(() => {
    setPage(current => Math.min(current, Math.max(1, Math.ceil(filteredUsers.length / pageSize))))
  }, [filteredUsers.length, pageSize])

  const columns: ColumnsType<UserRecord> = [
    { title: '序号', key: 'sequence', width: 68, align: 'center', render: (_, record) => filteredUsers.findIndex(item => item.id === record.id) + 1 },
    { title: '姓名', dataIndex: 'display_name', width: 140, render: (value, record) => <span className="access-user-name">{value}{record.id === currentUser?.id && <span className="access-current-badge">当前</span>}</span> },
    { title: '员工号', dataIndex: 'employee_no', width: 100 },
    { title: '短账号', dataIndex: 'short_account', width: 110, render: value => <strong className="short-account-value">{value || '—'}</strong> },
    { title: '登录账号', dataIndex: 'username', width: 130 },
    { title: '电话', dataIndex: 'phone', width: 130, render: value => value || '—' },
    { title: '角色', dataIndex: 'roles', width: 160, render: (value: RoleRecord[]) => <Space size={[4, 4]} wrap>{value.map(role => <Tag key={role.code}>{role.name}</Tag>)}</Space> },
    { title: '状态', dataIndex: 'status', width: 120, render: (value, record) => {
      const locked = Boolean(record.locked_until && new Date(record.locked_until).getTime() > Date.now())
      if (locked) return <Tag color="red">已锁定</Tag>
      const meta = STATUS_META[value as keyof typeof STATUS_META] || STATUS_META.active
      return <Tag color={meta.color}>{meta.label}</Tag>
    } },
    { title: '最近登录', dataIndex: 'last_login_at', width: 180, render: formatDateTime },
    { title: '最近操作', dataIndex: 'last_action_at', width: 180, render: formatDateTime },
    { title: '创建时间', dataIndex: 'created_at', width: 180, render: formatDateTime },
    {
      title: '操作', key: 'action', width: 410, fixed: 'right', render: (_, record) => {
        const locked = isGuest && record.created_by_user_id !== currentUser?.id
        return <Space className="access-row-actions" size={2}>
          {(isGuest || hasPermission('user.edit')) && (
            <GuestActionHint guest={locked}>
              <Button disabled={locked} type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
            </GuestActionHint>
          )}
          {(isGuest || (hasPermission('user.reset_credential')
            && (!record.roles.some(role => role.code === 'superadmin') || record.id === currentUser?.id))) && (
            <GuestActionHint guest={locked}>
              <Button disabled={locked} type="text" size="small" icon={<KeyOutlined />} onClick={() => {
                setResetCredentialType('password')
                resetForm.resetFields()
                setResetting(record)
              }}>重置凭证</Button>
            </GuestActionHint>
          )}
          {(isGuest || (hasPermission('user.edit')
            && record.locked_until
            && new Date(record.locked_until).getTime() > Date.now())) && (
            <GuestActionHint guest={locked}>
              <Button disabled={locked} type="text" size="small" icon={<LockOutlined />} onClick={() => unlockUser(record)}>解锁</Button>
            </GuestActionHint>
          )}
          {(isGuest || hasPermission('user.session')) && (
            <GuestActionHint guest={locked}>
              <Button disabled={locked} type="text" size="small" icon={<LogoutOutlined />} onClick={() => loadSessions(record)}>会话</Button>
            </GuestActionHint>
          )}
          {isGuest && locked ? (
            <GuestActionHint guest>
              <Button disabled type="text" size="small">{record.status === 'disabled' ? '启用' : '停用'}</Button>
            </GuestActionHint>
          ) : hasPermission('user.disable')
            && record.id !== currentUser?.id
            && !record.roles.some(role => role.code === 'superadmin') && (
            <Popconfirm title={record.status === 'disabled' ? '确认启用此用户？' : '确认停用此用户？'} onConfirm={() => toggleStatus(record)}>
              <Button type="text" size="small" danger={record.status !== 'disabled'}>{record.status === 'disabled' ? '启用' : '停用'}</Button>
            </Popconfirm>
          )}
          {isGuest && locked ? (
            <GuestActionHint guest>
              <Button disabled type="text" size="small" icon={<DeleteOutlined />}>删除</Button>
            </GuestActionHint>
          ) : hasPermission('user.delete')
            && record.id !== currentUser?.id
            && !record.roles.some(role => role.code === 'superadmin') && (
            <Popconfirm
              title={`删除用户“${record.display_name}”？`}
              description="该用户的登录会话将一并失效，操作日志会继续保留。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deletingUserId === record.id }}
              onConfirm={() => deleteUser(record)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      },
    },
  ]

  return (
    <div className="access-panel">
      <div className="access-toolbar">
        <div className="access-toolbar-filters">
          <Input.Search value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1) }} allowClear enterButton="搜索" placeholder="搜索姓名 / 员工号 / 账号" />
          <Select
            value={roleFilter}
            onChange={value => { setRoleFilter(value); setPage(1) }}
            style={{ width: 140 }}
            options={[{ value: 'all', label: '全部角色' }, ...roleFilterOptions]}
          />
          <Select
            value={statusFilter}
            onChange={value => { setStatusFilter(value); setPage(1) }}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '启用' },
              { value: 'password_change_required', label: '待修改密码' },
              { value: 'locked', label: '已锁定' },
              { value: 'disabled', label: '已停用' },
            ]}
          />
        </div>
        {(isGuest || (hasPermission('user.create') && hasPermission('role.assign') && hasPermission('role.view'))) && (
          <GuestActionHint guest={false}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加用户</Button>
          </GuestActionHint>
        )}
      </div>
      <SettingsTableFrame
        total={filteredUsers.length}
        unit="名用户"
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      >
        {bodyHeight => (
          <Table
            className="pos-table settings-data-table"
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={pagedUsers}
            scroll={{ x: 1930, y: bodyHeight }}
            pagination={false}
          />
        )}
      </SettingsTableFrame>

      <Modal title={editing ? `编辑用户 · ${editing.display_name}` : '添加用户'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} confirmLoading={submitting} okText="保存" cancelText="取消" width={680} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <div className="access-form-grid">
            <Form.Item label="姓名" name="display_name" rules={[{ required: true, message: '请输入姓名' }]}><Input /></Form.Item>
            <Form.Item label="员工号" name="employee_no" rules={[{ required: true, message: '请输入员工号' }]}><Input /></Form.Item>
            <Form.Item label="短账号" name="short_account" rules={[{ required: true, pattern: /^[A-Za-z0-9]{2,12}$/, message: '请输入 2 至 12 位字母或数字' }]}><Input placeholder="用于快速登录" /></Form.Item>
            <Form.Item label="登录账号" name="username" rules={[{ required: true, message: '请输入登录账号' }]}><Input autoComplete="off" /></Form.Item>
            <Form.Item label="手机号（可选）" name="phone"><Input /></Form.Item>
            {!editing && <Form.Item label="临时密码" name="password" rules={[{ required: true, min: 8, message: '至少 8 位，包含字母和数字' }]}><Input.Password autoComplete="new-password" /></Form.Item>}
            {!editing && <Form.Item label="临时短密码" name="short_password" rules={[{ required: true, pattern: /^\d{4,8}$/, message: '请输入 4 至 8 位数字' }]}><Input.Password inputMode="numeric" maxLength={8} /></Form.Item>}
            <Form.Item className="access-form-full" label="角色" name="role_codes" rules={[{ required: true, message: '至少选择一个角色' }]}>
              <Select
                mode="multiple"
                options={roles
                  .filter(role => role.code !== 'superadmin' || currentIsSuperadmin)
                  .filter(role => !isGuest || role.code === 'guest' || role.created_by_user_id === currentUser?.id)
                  .map(role => ({ label: role.name, value: role.code }))}
                disabled={editing !== null && !hasPermission('role.assign')}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal title={resetting ? `重置凭证 · ${resetting.display_name}` : '重置凭证'} open={resetting !== null} onCancel={() => setResetting(null)} onOk={() => resetForm.submit()} confirmLoading={submitting} okText="确认重置" cancelText="取消" destroyOnClose>
        <p className="access-modal-note">
          每次仅重置一种凭证。重置后该用户的全部登录会话将立即失效。
        </p>
        <Segmented
          block
          className="credential-reset-switch"
          value={resetCredentialType}
          options={[
            { value: 'password', label: '重置账号密码' },
            { value: 'short_password', label: '重置短密码' },
          ]}
          onChange={value => {
            setResetCredentialType(value as 'password' | 'short_password')
            resetForm.resetFields()
          }}
        />
        <Form form={resetForm} layout="vertical" onFinish={submitReset}>
          {resetCredentialType === 'password' ? (
            <Form.Item label="新临时账号密码" name="password" rules={[{ required: true, min: 8, message: '至少 8 位，包含字母和数字' }]}>
              <Input.Password autoComplete="new-password" placeholder="至少 8 位，包含字母和数字" />
            </Form.Item>
          ) : (
            <Form.Item label="新短密码" name="short_password" rules={[{ required: true, pattern: /^\d{4,8}$/, message: '请输入 4 至 8 位数字' }]}>
              <Input.Password inputMode="numeric" maxLength={8} placeholder="4 至 8 位数字" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title={sessionUser ? `登录会话 · ${sessionUser.display_name}` : '登录会话'}
        open={sessionUser !== null}
        onCancel={() => { setSessionUser(null); setSessions([]) }}
        footer={<Button onClick={() => { setSessionUser(null); setSessions([]) }}>关闭</Button>}
        width={920}
        destroyOnClose
      >
        <Table<SessionRecord>
          rowKey="id"
          size="small"
          loading={sessionsLoading}
          pagination={false}
          dataSource={sessions}
          scroll={{ x: 920, y: 360 }}
          columns={[
            { title: '登录方式', dataIndex: 'login_method', width: 90, render: value => value === 'short' ? '短账号' : '账号密码' },
            { title: 'IP 地址', dataIndex: 'ip_address', width: 130, render: value => value || '—' },
            { title: '最近活动', dataIndex: 'last_activity_at', width: 180, render: formatDateTime },
            { title: '到期时间', dataIndex: 'expires_at', width: 180, render: formatDateTime },
            { title: '状态', key: 'status', width: 100, render: (_, record) => record.active ? <Tag color={record.id === currentSession?.id ? 'blue' : 'green'}>{record.id === currentSession?.id ? '当前会话' : record.locked ? '已锁定' : '在线'}</Tag> : <Tag>已失效</Tag> },
            { title: '操作', key: 'action', width: 90, fixed: 'right', render: (_, record) => record.active && <Popconfirm title={record.id === currentSession?.id ? '下线当前会话后需要重新登录，确认继续？' : '确认下线此会话？'} onConfirm={() => revokeSession(record)}><Button type="text" danger size="small">下线</Button></Popconfirm> },
          ]}
        />
      </Modal>
    </div>
  )
}


export function RoleManagementPanel() {
  const { user: currentUser, hasPermission, refresh } = useAuth()
  const currentIsSuperadmin = Boolean(currentUser?.roles.some(role => role.code === 'superadmin'))
  const isGuest = Boolean(currentUser?.roles.some(role => role.code === 'guest'))
  const [roles, setRoles] = useState<RoleRecord[]>([])
  const [permissions, setPermissions] = useState<PermissionRecord[]>([])
  const [editing, setEditing] = useState<RoleRecord | 'new' | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingRoleId, setDeletingRoleId] = useState<number | null>(null)
  const [rolePendingDelete, setRolePendingDelete] = useState<RoleRecord | null>(null)
  const [replacementRoleId, setReplacementRoleId] = useState<number | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [roleKeyword, setRoleKeyword] = useState('')
  const [form] = Form.useForm()
  const selectedPermissions = (Form.useWatch('permissions', form) || []) as string[]

  const load = async () => {
    setLoading(true)
    try {
      const [roleResponse, permissionResponse] = await Promise.all([
        axios.get('/api/roles'),
        axios.get('/api/roles/permissions'),
      ])
      setRoles(roleResponse.data.data)
      setPermissions(permissionResponse.data.data)
    } catch (error: any) {
      message.error(error?.response?.data?.error || '获取角色数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, PermissionRecord[]>()
    permissions.forEach(permission => groups.set(permission.module, [...(groups.get(permission.module) || []), permission]))
    return Array.from(groups.entries())
  }, [permissions])

  const openRole = (role?: RoleRecord) => {
    if (role) {
      setEditing(role)
      form.setFieldsValue(role)
    } else {
      setEditing('new')
      form.resetFields()
      form.setFieldsValue({ default_view: 'tables', permissions: [] })
    }
  }

  const submit = async (values: Record<string, unknown>) => {
    if (!editing || (editing !== 'new' && editing.code === 'superadmin')) return
    setSubmitting(true)
    try {
      if (editing === 'new') await axios.post('/api/roles', values)
      else await axios.patch(`/api/roles/${editing.id}`, values)
      message.success(editing === 'new' ? '角色已创建' : '角色已更新')
      setEditing(null)
      await load()
      await refresh()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const deleteRole = async (role: RoleRecord) => {
    setDeletingRoleId(role.id)
    try {
      const response = await axios.delete(`/api/roles/${role.id}`, {
        data: replacementRoleId ? { replacement_role_id: replacementRoleId } : undefined,
      })
      const reassignedCount = Number(response.data.reassigned_user_count || 0)
      message.success(reassignedCount
        ? `角色“${role.name}”已删除，${reassignedCount} 名用户已完成改派`
        : `角色“${role.name}”已删除`)
      setRolePendingDelete(null)
      setReplacementRoleId(undefined)
      await load()
      await refresh()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '删除角色失败')
    } finally {
      setDeletingRoleId(null)
    }
  }

  const columns: ColumnsType<RoleRecord> = [
    { title: '序号', key: 'sequence', width: 68, align: 'center', render: (_, record) => filteredRoles.findIndex(item => item.id === record.id) + 1 },
    { title: '角色', dataIndex: 'name', width: 160, render: value => <span className="role-name-cell"><strong>{value}</strong></span> },
    { title: '角色代码', dataIndex: 'code', width: 150 },
    { title: '说明', dataIndex: 'description' },
    { title: '权限数', dataIndex: 'permissions', width: 90, align: 'center', render: (value: string[]) => value.length },
    { title: '用户数', dataIndex: 'user_count', width: 90, align: 'center' },
    {
      title: '操作', key: 'action', width: 180, render: (_, record) => {
        const locked = isGuest && record.created_by_user_id !== currentUser?.id
        return <Space size={2}>
          {(isGuest || record.code === 'superadmin' || hasPermission('role.edit')) && (
            <GuestActionHint guest={locked}>
              <Button disabled={locked} type="text" icon={<EditOutlined />} onClick={() => openRole(record)}>
                {record.code === 'superadmin' ? '查看' : '编辑'}
              </Button>
            </GuestActionHint>
          )}
          {(isGuest || (hasPermission('role.delete') && record.code !== 'superadmin')) && (
            <GuestActionHint guest={locked}>
              <Button
                disabled={locked}
                type="text"
                danger={!locked}
                icon={<DeleteOutlined />}
                onClick={() => {
                  setRolePendingDelete(record)
                  setReplacementRoleId(undefined)
                }}
              >删除</Button>
            </GuestActionHint>
          )}
        </Space>
      },
    },
  ]

  const editingRole = editing === 'new' ? null : editing
  const readOnly = editingRole?.code === 'superadmin'
  const filteredRoles = useMemo(() => {
    const normalized = roleKeyword.trim().toLowerCase()
    const visibleRoles = currentIsSuperadmin
      ? roles
      : roles.filter(role => role.code !== 'superadmin')
    if (!normalized) return visibleRoles
    return visibleRoles.filter(role => [role.name, role.code, role.description]
      .some(value => value.toLowerCase().includes(normalized)))
  }, [roles, roleKeyword, currentIsSuperadmin])
  const pagedRoles = useMemo(
    () => filteredRoles.slice((page - 1) * pageSize, page * pageSize),
    [filteredRoles, page, pageSize],
  )

  useEffect(() => {
    setPage(current => Math.min(current, Math.max(1, Math.ceil(filteredRoles.length / pageSize))))
  }, [filteredRoles.length, pageSize])

  const toggleModulePermissions = (items: PermissionRecord[]) => {
    const moduleCodes = items.map(item => item.code)
    const selected = new Set(selectedPermissions)
    const allSelected = moduleCodes.every(code => selected.has(code))
    moduleCodes.forEach(code => allSelected ? selected.delete(code) : selected.add(code))
    form.setFieldValue('permissions', Array.from(selected))
  }

  return (
    <div className="access-panel">
      <div className="access-toolbar">
        <Input.Search
          value={roleKeyword}
          onChange={event => { setRoleKeyword(event.target.value); setPage(1) }}
          allowClear
          enterButton="搜索"
          placeholder="搜索角色名称 / 代码 / 说明"
        />
        {(isGuest || hasPermission('role.create')) && (
          <GuestActionHint guest={false}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openRole()}>添加角色</Button>
          </GuestActionHint>
        )}
      </div>
      <SettingsTableFrame
        total={filteredRoles.length}
        unit="个角色"
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      >
        {bodyHeight => (
          <Table
            className="pos-table settings-data-table"
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={pagedRoles}
            scroll={{ y: bodyHeight }}
            pagination={false}
          />
        )}
      </SettingsTableFrame>
      <Modal
        title={rolePendingDelete ? `删除角色 · ${rolePendingDelete.name}` : '删除角色'}
        open={rolePendingDelete !== null}
        onCancel={() => {
          setRolePendingDelete(null)
          setReplacementRoleId(undefined)
        }}
        onOk={() => rolePendingDelete && deleteRole(rolePendingDelete)}
        okText="确认删除"
        cancelText="取消"
        confirmLoading={deletingRoleId === rolePendingDelete?.id}
        okButtonProps={{
          danger: true,
          disabled: Boolean(rolePendingDelete?.user_count && (!replacementRoleId || !hasPermission('role.assign'))),
        }}
        destroyOnClose
      >
        {rolePendingDelete?.user_count ? (
          <>
            <p className="access-modal-note">
              当前有 {rolePendingDelete.user_count} 名用户使用该角色。请选择接替角色，确认后系统会先完成用户改派，再删除原角色。
            </p>
            {!hasPermission('role.assign') && <p className="access-modal-note access-modal-warning">当前账号没有“分配角色”权限，无法删除仍被用户使用的角色。</p>}
            <Form.Item label="接替角色" required>
              <Select
                value={replacementRoleId}
                onChange={setReplacementRoleId}
                disabled={!hasPermission('role.assign')}
                placeholder="请选择接替角色"
                options={roles
                  .filter(role => role.id !== rolePendingDelete.id && role.code !== 'superadmin')
                  .filter(role => !isGuest || role.code === 'guest' || role.created_by_user_id === currentUser?.id)
                  .map(role => ({ value: role.id, label: `${role.name}（${role.code}）` }))}
              />
            </Form.Item>
          </>
        ) : (
          <p>删除后无法恢复，确认删除该角色吗？</p>
        )}
      </Modal>
      <Modal
        rootClassName="role-permission-modal-root"
        title={editing === 'new' ? '添加角色' : `${readOnly ? '查看' : '编辑'}角色 · ${editingRole?.name || ''}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        footer={readOnly ? <Button onClick={() => setEditing(null)}>关闭</Button> : undefined}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={1040}
        style={{ top: 24 }}
        styles={{ body: { overflow: 'hidden' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={submit} disabled={readOnly} requiredMark={false}>
          <div className="access-form-grid role-basic-grid">
            <Form.Item label="角色名称" name="name" rules={[{ required: true, message: '请输入角色名称' }]}><Input disabled={editingRole?.code === 'superadmin'} /></Form.Item>
            <Form.Item
              label="角色代码"
              name="code"
              rules={[
                { required: true, message: '请输入角色代码' },
                { pattern: /^[A-Za-z0-9_]+$/, message: '仅支持字母、数字和下划线' },
              ]}
            ><Input disabled={readOnly} placeholder="如：shift_leader" /></Form.Item>
            <Form.Item className="role-description-field" label="角色说明" name="description"><Input disabled={editingRole?.code === 'superadmin'} /></Form.Item>
            <Form.Item label="默认首页" name="default_view">
              <Select disabled={editingRole?.code === 'superadmin'} options={[{ value: 'tables', label: '桌台' }, { value: 'history', label: '订单历史' }, { value: 'production-history', label: '制作单记录' }, { value: 'settings', label: '设置' }]} />
            </Form.Item>
          </div>
          <Form.Item label="权限范围" name="permissions">
            <Checkbox.Group className="permission-group-list">
              {permissionGroups.map(([module, items]) => (
                <div className="permission-module" key={module}>
                  <div className="permission-module-head">
                    <strong>{module}</strong>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => toggleModulePermissions(items)}
                    >{items.every(item => selectedPermissions.includes(item.code)) ? '取消全选' : '全选'}</button>
                  </div>
                  <div>{items.map(item => <Checkbox key={item.code} value={item.code} title={item.description}>{item.action}</Checkbox>)}</div>
                </div>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
