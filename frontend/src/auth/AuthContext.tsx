import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import axios from 'axios'
import { setCsrfToken } from './client'

export interface AuthRole {
  id: number
  code: string
  name: string
  description: string
  is_system: boolean
  default_view: string
}

export interface AuthUser {
  id: string
  username: string
  employee_no: string
  short_account: string
  display_name: string
  phone?: string | null
  status: 'active' | 'disabled' | 'password_change_required'
  roles: AuthRole[]
  permissions: string[]
  last_login_at?: string | null
  data_scope?: 'all' | 'own_created'
  created_by_user_id?: string | null
}

interface AuthPayload {
  user: AuthUser
  csrf_token: string
  session: {
    id: string
    login_method: 'password' | 'short'
    locked: boolean
    created_at: string
    expires_at: string
  }
  default_view: string
}

export type AuthStage = 'loading' | 'bootstrap' | 'login' | 'credential-change' | 'authenticated' | 'locked'

interface AuthContextValue {
  stage: AuthStage
  user: AuthUser | null
  session: AuthPayload['session'] | null
  defaultView: string
  hasPermission: (code: string) => boolean
  bootstrap: (values: BootstrapValues) => Promise<void>
  loginWithPassword: (identifier: string, password: string) => Promise<void>
  loginWithShortCredential: (shortAccount: string, shortPassword: string) => Promise<void>
  switchAccount: (identifier: string, method: 'password' | 'short', secret: string) => Promise<void>
  logout: () => Promise<void>
  lock: () => Promise<void>
  unlock: (method: 'password' | 'short', secret: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  refresh: () => Promise<void>
}

export interface BootstrapValues {
  display_name: string
  username: string
  employee_no: string
  short_account: string
  phone?: string
  password: string
  short_password: string
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<AuthStage>('loading')
  const [payload, setPayload] = useState<AuthPayload | null>(null)

  const applyPayload = useCallback((next: AuthPayload) => {
    setPayload(next)
    setCsrfToken(next.csrf_token)
    setStage(next.session.locked ? 'locked' : next.user.status === 'password_change_required' ? 'credential-change' : 'authenticated')
  }, [])

  const refresh = useCallback(async () => {
    try {
      const response = await axios.get('/api/auth/me')
      applyPayload(response.data.data)
    } catch (error: any) {
      if (error?.response?.status === 423) {
        setStage('locked')
        return
      }
      setPayload(null)
      setCsrfToken('')
      setStage('login')
    }
  }, [applyPayload])

  useEffect(() => {
    let active = true
    axios.get('/api/auth/bootstrap-status')
      .then(async response => {
        if (!active) return
        if (!response.data.data.initialized) {
          setStage('bootstrap')
          return
        }
        await refresh()
      })
      .catch(() => {
        if (active) setStage('login')
      })
    const onExpired = () => {
      setPayload(null)
      setCsrfToken('')
      setStage('login')
    }
    const onLocked = () => setStage('locked')
    const onPermissionRefresh = () => refresh()
    window.addEventListener('pos-auth-expired', onExpired)
    window.addEventListener('pos-session-locked', onLocked)
    window.addEventListener('pos-auth-refresh', onPermissionRefresh)
    return () => {
      active = false
      window.removeEventListener('pos-auth-expired', onExpired)
      window.removeEventListener('pos-session-locked', onLocked)
      window.removeEventListener('pos-auth-refresh', onPermissionRefresh)
    }
  }, [refresh])

  useEffect(() => {
    if (stage !== 'authenticated') return undefined
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh, stage])

  const bootstrap = useCallback(async (values: BootstrapValues) => {
    const response = await axios.post('/api/auth/bootstrap', values)
    applyPayload(response.data.data)
  }, [applyPayload])

  const loginWithPassword = useCallback(async (identifier: string, password: string) => {
    const response = await axios.post('/api/auth/login/password', { identifier, password })
    applyPayload(response.data.data)
  }, [applyPayload])

  const loginWithShortCredential = useCallback(async (shortAccount: string, shortPassword: string) => {
    const response = await axios.post('/api/auth/login/short', { identifier: shortAccount, short_password: shortPassword })
    applyPayload(response.data.data)
  }, [applyPayload])

  const switchAccount = useCallback(async (identifier: string, method: 'password' | 'short', secret: string) => {
    const credentials = method === 'short' ? { short_password: secret } : { password: secret }
    const response = await axios.post('/api/auth/switch', { identifier, method, ...credentials })
    applyPayload(response.data.data)
  }, [applyPayload])

  const logout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout')
    } finally {
      setPayload(null)
      setCsrfToken('')
      setStage('login')
    }
  }, [])

  const lock = useCallback(async () => {
    await axios.post('/api/auth/lock')
    setStage('locked')
  }, [])

  const unlock = useCallback(async (method: 'password' | 'short', secret: string) => {
    const body = method === 'short' ? { method, short_password: secret } : { method, password: secret }
    const response = await axios.post('/api/auth/unlock', body)
    applyPayload(response.data.data)
  }, [applyPayload])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await axios.put('/api/auth/password', { current_password: currentPassword, new_password: newPassword })
    await refresh()
  }, [refresh])

  const permissions = payload?.user.permissions || []
  const permissionSet = useMemo(() => new Set(permissions), [permissions])
  const value = useMemo<AuthContextValue>(() => ({
    stage,
    user: payload?.user || null,
    session: payload?.session || null,
    defaultView: payload?.default_view || 'tables',
    hasPermission: code => permissionSet.has(code),
    bootstrap,
    loginWithPassword,
    loginWithShortCredential,
    switchAccount,
    logout,
    lock,
    unlock,
    changePassword,
    refresh,
  }), [stage, payload, permissionSet, bootstrap, loginWithPassword, loginWithShortCredential, switchAccount, logout, lock, unlock, changePassword, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
