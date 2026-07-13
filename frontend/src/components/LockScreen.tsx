import { useState } from 'react'
import { Avatar, Button, Input, Segmented, message } from 'antd'
import { LockOutlined, LogoutOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'


export function LockScreen() {
  const { user, session, unlock, logout } = useAuth()
  const [method, setMethod] = useState<'password' | 'short'>(session?.login_method === 'password' ? 'password' : 'short')
  const [secret, setSecret] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    try {
      await unlock(method, secret)
      setSecret('')
    } catch (error: any) {
      message.error(error?.response?.data?.error || '解锁失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page auth-lock-page">
      <section className="auth-card auth-lock-card">
        <div className="auth-lock-icon"><LockOutlined /></div>
        <Avatar size={58}>{user?.display_name?.slice(0, 1)}</Avatar>
        <h1>{user?.display_name}</h1>
        <p>系统已锁定，验证身份后继续</p>
        <Segmented
          block
          value={method}
          onChange={value => { setMethod(value as 'password' | 'short'); setSecret('') }}
          options={[{ label: '账号密码', value: 'password' }, { label: '短密码', value: 'short' }]}
        />
        <Input.Password
          size="large"
          autoFocus
          value={secret}
          inputMode={method === 'short' ? 'numeric' : undefined}
          maxLength={method === 'short' ? 8 : undefined}
          placeholder={method === 'short' ? '请输入短密码' : '请输入登录密码'}
          onChange={event => setSecret(event.target.value)}
          onPressEnter={submit}
        />
        <Button block size="large" type="primary" loading={loading} disabled={!secret} onClick={submit}>解锁</Button>
        <Button type="text" icon={<LogoutOutlined />} onClick={logout}>退出当前账号</Button>
      </section>
    </div>
  )
}
