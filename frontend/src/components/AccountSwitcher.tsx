import { useEffect, useState } from 'react'
import { Alert, Form, Input, Modal, Segmented, message } from 'antd'
import { LockOutlined, SafetyCertificateOutlined, UserSwitchOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'


interface Props {
  open: boolean
  onClose: () => void
}

interface SwitchValues {
  identifier: string
  secret: string
}

export default function AccountSwitcher({ open, onClose }: Props) {
  const { user, switchAccount } = useAuth()
  const [method, setMethod] = useState<'short' | 'password'>('short')
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<SwitchValues>()

  useEffect(() => {
    if (open) {
      setMethod('short')
      form.resetFields()
      window.setTimeout(() => form.getFieldInstance('identifier')?.focus?.(), 0)
    }
  }, [open, form])

  const submit = async (values: SwitchValues) => {
    setSubmitting(true)
    try {
      await switchAccount(values.identifier, method, values.secret)
      message.success('账号切换成功')
      onClose()
    } catch (error: any) {
      message.error(error?.response?.data?.error || '账号切换失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={<span className="account-switch-title"><UserSwitchOutlined />切换账号</span>}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认切换"
      cancelText="取消"
      confirmLoading={submitting}
      width={440}
      destroyOnClose
    >
      <div className="account-switch-current">
        <span>当前账号</span>
        <strong>{user?.display_name}</strong>
        <em>短账号 {user?.short_account}</em>
      </div>
      <Alert
        type="info"
        showIcon
        message="验证成功后，当前账号会立即退出，页面将以新账号权限重新加载。"
      />
      <Segmented
        block
        className="account-switch-method"
        value={method}
        options={[{ label: '短账号登录', value: 'short' }, { label: '账号密码', value: 'password' }]}
        onChange={value => {
          setMethod(value as 'short' | 'password')
          form.setFieldValue('secret', '')
        }}
      />
      <Form form={form} layout="vertical" size="large" requiredMark={false} onFinish={submit}>
        <Form.Item
          label={method === 'short' ? '目标短账号' : '目标账号 / 员工号'}
          name="identifier"
          rules={[{ required: true, message: '请输入要切换的账号' }]}
        >
          <Input placeholder={method === 'short' ? '请输入短账号' : '请输入登录账号或员工号'} />
        </Form.Item>
        <Form.Item
          label={method === 'short' ? '短密码' : '登录密码'}
          name="secret"
          rules={method === 'short'
            ? [{ required: true, pattern: /^\d{4,8}$/, message: '请输入 4 至 8 位数字短密码' }]
            : [{ required: true, message: '请输入登录密码' }]}
        >
          <Input.Password
            prefix={method === 'short' ? <SafetyCertificateOutlined /> : <LockOutlined />}
            inputMode={method === 'short' ? 'numeric' : undefined}
            maxLength={method === 'short' ? 8 : undefined}
            autoComplete="current-password"
            placeholder={method === 'short' ? '请输入短密码' : '请输入登录密码'}
            onPressEnter={() => form.submit()}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
