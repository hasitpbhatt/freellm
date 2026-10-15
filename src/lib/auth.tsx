import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { AuthContext } from './authContext'
import type { User } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [loading, setLoadingState] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User | null }>('/me')
      setUserState(data.user)
    } catch {
      setUserState(null)
    } finally {
      setLoadingState(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- session hydration on mount, synchronizing with an external system
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await api.post('/auth/logout')
    setUserState(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
