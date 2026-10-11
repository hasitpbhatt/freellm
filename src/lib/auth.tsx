import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import type { User } from './types'

type AuthState = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (email: string, username: string, password: string, referralCode?: string) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User | null }>('/me')
      setUser(data.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: User }>('/auth/login', { email, password })
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (email: string, username: string, password: string, referralCode?: string) => {
    const data = await api.post<{ user: User }>('/auth/register', {
      email,
      username,
      password,
      referral_code: referralCode,
    })
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
