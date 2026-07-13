import axios from 'axios'

let csrfToken = ''
let installed = false

axios.defaults.withCredentials = true

export function setCsrfToken(value?: string | null) {
  csrfToken = value || ''
}

export function installAuthInterceptors() {
  if (installed) return
  installed = true
  axios.interceptors.request.use(config => {
    const method = (config.method || 'get').toLowerCase()
    if (!['get', 'head', 'options'].includes(method) && csrfToken) {
      config.headers.set('X-CSRF-Token', csrfToken)
    }
    return config
  })
  axios.interceptors.response.use(
    response => response,
    error => {
      const status = error?.response?.status
      const code = error?.response?.data?.code
      if (status === 401 && !String(error?.config?.url || '').includes('/api/auth/login')) {
        window.dispatchEvent(new CustomEvent('pos-auth-expired'))
      } else if (status === 423 || code === 'SESSION_LOCKED') {
        window.dispatchEvent(new CustomEvent('pos-session-locked'))
      } else if (status === 403 && code === 'PERMISSION_DENIED') {
        window.dispatchEvent(new CustomEvent('pos-auth-refresh'))
      }
      return Promise.reject(error)
    },
  )
}

installAuthInterceptors()
