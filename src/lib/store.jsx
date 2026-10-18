import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth.jsx'
import { LOCAL_MODE } from './mode'
import { createApi, loadAccess } from './data'
import { localUserKey } from './localUsers'

// Akun -> daftar toko + peran per toko + toko yang sedang dipilih. Semua data aplikasi
// diambil lewat `api` yang terikat ke toko aktif, jadi halaman tidak pernah menyentuh
// data toko lain.
const StoreContext = createContext(null)
const activeKey = (uid) => `mmg-store:${uid}`

function readActive(uid) {
  try {
    return localStorage.getItem(activeKey(uid))
  } catch {
    return null
  }
}

export function StoreProvider({ children }) {
  const { userId, signOut } = useAuth()
  const [state, setState] = useState({ status: 'loading' })
  const [storeId, setStoreId] = useState(null)

  useEffect(() => {
    let active = true
    loadAccess({ userId, localKey: LOCAL_MODE ? localUserKey() : null })
      .then(({ profile, stores }) => {
        if (!active) return
        if (!profile) return setState({ status: 'no-profile' })
        if (stores.length === 0) return setState({ status: 'no-store', profile })
        const uid = profile.id
        const saved = readActive(uid)
        setStoreId(stores.some((s) => s.id === saved) ? saved : stores[0].id)
        setState({ status: 'ready', profile, stores })
      })
      .catch(() => active && setState({ status: 'error' }))
    return () => { active = false }
  }, [userId])

  const select = useCallback((id) => {
    setStoreId(id)
    try {
      localStorage.setItem(activeKey(state.profile.id), id)
    } catch {
      // abaikan: pilihan toko tidak diingat
    }
  }, [state.profile])

  const value = useMemo(() => {
    if (state.status !== 'ready') return { status: state.status, signOut }
    const store = state.stores.find((s) => s.id === storeId) ?? state.stores[0]
    const user = { id: state.profile.id, nama: state.profile.nama }
    return {
      status: 'ready',
      user,
      isPlatformOwner: Boolean(state.profile.is_platform_owner),
      stores: state.stores,
      store,
      selectStore: select,
      role: store.role,
      isAdmin: store.role === 'admin',
      api: createApi({ store, user, role: store.role, isPlatformOwner: Boolean(state.profile.is_platform_owner) }),
      signOut,
    }
  }, [state, storeId, select, signOut])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore harus di dalam StoreProvider')
  return ctx
}
