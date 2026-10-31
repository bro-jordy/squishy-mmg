import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, LocalAuthProvider, useAuth } from './lib/auth.jsx'
import { StoreProvider, useStore } from './lib/store.jsx'
import { supabaseConfigured } from './lib/supabase'
import { LOCAL_MODE } from './lib/mode'
import Layout from './components/Layout.jsx'
import AdminOnly from './components/AdminOnly.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Kasir from './pages/Kasir.jsx'
import Transaksi from './pages/Transaksi.jsx'
import Barang from './pages/Barang.jsx'
import MasterBarang from './pages/MasterBarang.jsx'
import Stok from './pages/Stok.jsx'
import OpnameMassal from './pages/OpnameMassal.jsx'
import TransferStok from './pages/TransferStok.jsx'
import BagiHasil from './pages/BagiHasil.jsx'
import Pengaturan from './pages/Pengaturan.jsx'
import PengaturanUmum from './pages/PengaturanUmum.jsx'
import Pengguna from './pages/Pengguna.jsx'

function Notice({ title, children }) {
  const { signOut } = useStore()
  return (
    <div className="center-note">
      <h1>{title}</h1>
      <p>{children}</p>
      {!LOCAL_MODE && <button onClick={signOut}>Keluar</button>}
    </div>
  )
}

function Shell() {
  const { status, isAdmin } = useStore()

  if (status === 'loading') return <p className="center-note" role="status">Memuat…</p>
  if (status === 'no-profile') {
    return <Notice title="Akun belum terdaftar">Akun ini belum didaftarkan di Squishy Zoyu (atau sudah dinonaktifkan). Hubungi admin.</Notice>
  }
  if (status === 'no-store') {
    return <Notice title="Belum ada toko">Akun ini belum terdaftar di toko mana pun, atau aksesnya dinonaktifkan. Hubungi admin toko.</Notice>
  }
  if (status === 'error') {
    return <Notice title="Gagal memuat">Tidak bisa memuat data akun. Periksa koneksi lalu muat ulang halaman.</Notice>
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={isAdmin ? <Dashboard /> : <Navigate to="/kasir" replace />} />
        <Route path="kasir" element={<Kasir />} />
        <Route path="transaksi" element={<Transaksi />} />
        <Route path="barang" element={<AdminOnly title="Barang"><Barang /></AdminOnly>}>
          <Route index element={<Navigate to="master" replace />} />
          <Route path="master" element={<MasterBarang />} />
          <Route path="stok" element={<Stok />} />
          <Route path="stok/opname" element={<OpnameMassal />} />
          <Route path="transfer" element={<TransferStok />} />
        </Route>
        <Route path="bagi-hasil" element={<AdminOnly title="Bagi Hasil"><BagiHasil /></AdminOnly>} />
        <Route path="pengaturan" element={<AdminOnly title="Pengaturan"><Pengaturan /></AdminOnly>}>
          <Route index element={<Navigate to="umum" replace />} />
          <Route path="umum" element={<PengaturanUmum />} />
          <Route path="pengguna" element={<Pengguna />} />
        </Route>
        {/* alamat lama */}
        <Route path="master-barang" element={<Navigate to="/barang/master" replace />} />
        <Route path="stok" element={<Navigate to="/barang/stok" replace />} />
        <Route path="setoran" element={<Navigate to="/bagi-hasil" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <p className="center-note" role="status">Memuat…</p>
  if (!session) return <Login />
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

export default function App() {
  if (LOCAL_MODE) {
    return (
      <LocalAuthProvider>
        <Gate />
      </LocalAuthProvider>
    )
  }
  if (!supabaseConfigured) {
    return (
      <div className="center-note">
        <h1>Supabase belum dikonfigurasi</h1>
        <p>
          Salin <code>.env.example</code> ke <code>.env.local</code>, isi{' '}
          <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code>, lalu jalankan ulang.
        </p>
      </div>
    )
  }
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
