import { useState } from 'react'
import { Button, Form, Input, message } from 'antd'
import { KeyOutlined, LogoutOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'


interface FormValues {
  current_password: string
  new_password: string
  confirm_password: string
}

export function CredentialChangePage() {
  const { user, changePassword, logout } = useAuth()
  const [loading, setLoading] = useState(false)

  const submit = async (values: FormValues) => {
    setLoading(true)
    try {
      await changePassword(values.current_password, values.new_password)
      message.success('密码已更新')
    } catch (error: any) {
      message.error(error?.response?.data?.error || '密码更新失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-card auth-credential-card">
        <div className="auth-heading">
          <KeyOutlined />
          <div><h1>设置个人密码</h1><p>{user?.display_name}，首次登录需要更换临时密码。</p></div>
        </div>
        <Form layout="vertical" size="large" requiredMark={false} onFinish={submit}>
          <Form.Item label="临时密码" name="current_password" rules={[{ required: true, message: '请输入临时密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item label="新密码" name="new_password" rules={[{ required: true, min: 8, message: '至少 8 位，包含字母和数字' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="确认新密码" name="confirm_password" dependencies={['new_password']} rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('new_password') === value ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')) } }),
          ]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={loading}>保存并进入系统</Button>
        </Form>
        <Button type="text" icon={<LogoutOutlined />} onClick={logout}>退出当前账号</Button>
      </section>
    </div>
  )
}
