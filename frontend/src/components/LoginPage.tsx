import { useEffect, useState } from 'react'
import { Button, Form, Input, Segmented, message } from 'antd'
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
import type { BootstrapValues } from '../auth/AuthContext'
import { useAuth } from '../auth/AuthContext'
import axios from 'axios'


export function LoginPage() {
  const { stage, bootstrap, loginWithPassword, loginWithShortCredential } = useAuth()
  const [method, setMethod] = useState<'password' | 'short'>('password')
  const [submitting, setSubmitting] = useState(false)
  const [demoCredentials, setDemoCredentials] = useState<{ username: string; password: string } | null>(null)

  useEffect(() => {
    if (stage !== 'login') return
    axios.get('/api/auth/demo-credentials')
      .then(response => setDemoCredentials(response.data.data || null))
      .catch(() => setDemoCredentials(null))
  }, [stage])

  const submitLogin = async (values: { identifier: string; password?: string; short_password?: string }) => {
    setSubmitting(true)
    try {
      if (method === 'short') await loginWithShortCredential(values.identifier, values.short_password || '')
      else await loginWithPassword(values.identifier, values.password || '')
    } catch (error: any) {
      message.error(error?.response?.data?.error || '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submitBootstrap = async (values: BootstrapValues & { confirm_password: string }) => {
    setSubmitting(true)
    try {
      await bootstrap(values)
      message.success('系统管理员创建成功')
    } catch (error: any) {
      message.error(error?.response?.data?.error || '初始化失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />
      <section className={`auth-card${stage === 'bootstrap' ? ' auth-card-bootstrap' : ''}`}>
        <div className="auth-brand">
          <span className="auth-brand-mark">SL</span>
          <div>
            <strong>Silver Lining POS</strong>
            <span>{stage === 'bootstrap' ? '首次使用 · 创建系统管理员' : '门店运营管理系统'}</span>
          </div>
        </div>

        {stage === 'bootstrap' ? (
          <>
            <div className="auth-heading">
              <SafetyCertificateOutlined />
              <div><h1>初始化系统</h1><p>此账号将成为唯一的首位超级管理员，不使用默认密码。</p></div>
            </div>
            <Form layout="vertical" size="large" onFinish={submitBootstrap} requiredMark={false}>
              <div className="auth-form-grid">
                <Form.Item label="管理员姓名" name="display_name" rules={[{ required: true, message: '请输入管理员姓名' }]}>
                  <Input placeholder="如：门店负责人" />
                </Form.Item>
                <Form.Item label="员工号" name="employee_no" rules={[{ required: true, message: '请输入员工号' }]}>
                  <Input placeholder="如：0001" />
                </Form.Item>
                <Form.Item label="登录账号" name="username" rules={[{ required: true, message: '请输入登录账号' }]}>
                  <Input autoComplete="username" placeholder="如：admin" />
                </Form.Item>
                <Form.Item label="手机号（可选）" name="phone">
                  <Input placeholder="用于后续账号验证" />
                </Form.Item>
                <Form.Item label="短账号" name="short_account" rules={[{ required: true, pattern: /^[A-Za-z0-9]{2,12}$/, message: '请输入 2 至 12 位字母或数字' }]}>
                  <Input autoComplete="off" placeholder="用于快速登录，如 01" />
                </Form.Item>
                <Form.Item label="短密码" name="short_password" rules={[{ required: true, pattern: /^\d{4,8}$/, message: '请输入 4 至 8 位数字' }]}>
                  <Input.Password inputMode="numeric" maxLength={8} placeholder="用于快速登录" />
                </Form.Item>
                <Form.Item label="登录密码" name="password" rules={[{ required: true, message: '请输入登录密码' }, { min: 8, message: '至少 8 位，包含字母和数字' }]}>
                  <Input.Password autoComplete="new-password" placeholder="至少 8 位，包含字母和数字" />
                </Form.Item>
                <Form.Item label="确认密码" name="confirm_password" dependencies={['password']} rules={[
                  { required: true, message: '请再次输入密码' },
                  ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')) } }),
                ]}>
                  <Input.Password autoComplete="new-password" placeholder="再次输入登录密码" />
                </Form.Item>
              </div>
              <Button block type="primary" htmlType="submit" loading={submitting}>创建管理员并进入系统</Button>
            </Form>
          </>
        ) : (
          <>
            <div className="auth-heading">
              <LockOutlined />
              <div><h1>欢迎回来</h1><p>请选择账号密码或短账号快速登录</p></div>
            </div>
            <Segmented
              block
              className="auth-method-switch"
              value={method}
              onChange={value => setMethod(value as 'password' | 'short')}
              options={[{ label: '账号密码', value: 'password' }, { label: '短账号登录', value: 'short' }]}
            />
            <Form layout="vertical" size="large" onFinish={submitLogin} requiredMark={false}>
              <Form.Item label={method === 'short' ? '短账号' : '账号 / 员工号'} name="identifier" rules={[{ required: true, message: '请输入登录账号' }]}>
                <Input prefix={<UserOutlined />} autoComplete="username" placeholder={method === 'short' ? '请输入短账号' : '请输入登录账号或员工号'} />
              </Form.Item>
              {method === 'password' ? (
                <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="请输入登录密码" />
                </Form.Item>
              ) : (
                <Form.Item label="短密码" name="short_password" rules={[{ required: true, pattern: /^\d{4,8}$/, message: '请输入 4 至 8 位数字短密码' }]}>
                  <Input.Password prefix={<SafetyCertificateOutlined />} inputMode="numeric" maxLength={8} placeholder="请输入短密码" />
                </Form.Item>
              )}
              <Button block type="primary" htmlType="submit" loading={submitting}>登录</Button>
            </Form>
            {demoCredentials && (
              <div className="auth-demo-credentials">
                访客演示账号：{demoCredentials.username}<span>·</span>登录密码：{demoCredentials.password}
              </div>
            )}
            <div className="auth-security-note">连续多次输错会临时锁定账号，请妥善保管登录凭证</div>
          </>
        )}
      </section>
    </div>
  )
}
