import { create } from 'zustand'
import type { AdminDoc } from '@/types/admin'
import { useLabStore } from '@/store/labStore'

interface AuthState {
  user: any | null
  admin: AdminDoc | null
  labAccessIds: string[]
  initialized: boolean
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  init: () => () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  admin: null,
  labAccessIds: [],
  initialized: false,
  loading: false,
  error: null,

  signIn: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Login failed' }))
        throw new Error(err.error || `HTTP ${res.status}: ${res.statusText}`)
      }

      const adminProfile = await res.json()
      
      const mockUser = {
        uid: adminProfile.userId,
        email: adminProfile.email,
        displayName: adminProfile.displayName,
      }

      const labAccessIds = ['default-lab']

      const adminDoc: AdminDoc = {
        id: adminProfile.userId,
        firebaseUid: adminProfile.userId,
        email: adminProfile.email,
        displayName: adminProfile.displayName,
        type: adminProfile.type,
        status: adminProfile.status,
        labAccessIds
      }

      // Persist locally for session reload
      localStorage.setItem('auth_admin', JSON.stringify(adminDoc))
      localStorage.setItem('auth_user', JSON.stringify(mockUser))

      set({
        user: mockUser,
        admin: adminDoc,
        labAccessIds,
        loading: false,
        error: null
      })
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Login failed',
        loading: false,
      })
    }
  },

  signOut: async () => {
    localStorage.removeItem('auth_admin')
    localStorage.removeItem('auth_user')
    useLabStore.getState().clearLab()
    set({ user: null, admin: null, labAccessIds: [] })
  },

  init: () => {
    const storedAdmin = localStorage.getItem('auth_admin')
    const storedUser = localStorage.getItem('auth_user')
    if (storedAdmin && storedUser) {
      try {
        const admin = JSON.parse(storedAdmin)
        const user = JSON.parse(storedUser)
        set({
          user,
          admin,
          labAccessIds: admin.labAccessIds || ['default-lab'],
          initialized: true,
          loading: false,
          error: null
        })
      } catch {
        localStorage.removeItem('auth_admin')
        localStorage.removeItem('auth_user')
        set({ initialized: true })
      }
    } else {
      set({ initialized: true })
    }
    // Return unsubscribe no-op
    return () => {}
  },
}))
