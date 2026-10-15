import { createContext } from 'react'
import type { User } from './types'

export type AuthState = {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

// Kept in its own module so auth.tsx exports only the provider component and
// useAuth.ts only the hook — mixing them breaks Fast Refresh.
export const AuthContext = createContext<AuthState | null>(null)
