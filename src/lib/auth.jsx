import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

// Sesi login. Peran dan toko ditangani StoreProvider (lib/store.jsx), karena peran
// berlaku per toko.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback((email, password) => supabase.auth.signInWithPassword({ email, password }), [])
  const signOut = useCallback(() => supabase.auth.signOut(), [])
  const userId = session?.user?.id ?? null
  const value = useMemo(() => ({ session, userId, loading, signIn, signOut }), [session, userId, loading, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Mode lokal: tanpa login. Pilih pengguna contoh lewat alamat: ?sebagai=owner|rea|soso|kasir
export function LocalAuthProvider({ children }) {
  const [value] = useState(() => ({
    session: { local: true },
    userId: null,
    loading: false,
    signIn: async () => ({ error: null }),
    signOut: async () => {},
  }))
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus di dalam AuthProvider')
  return ctx
}
