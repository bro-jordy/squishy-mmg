import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LOCAL_MODE } from '../lib/mode'
import { cloneAvailable, resetLocalData, usingClone } from '../lib/data'
import { LOCAL_USERS } from '../lib/localUsers'
import { useStore } from '../lib/store.jsx'
import { useMediaQuery } from '../lib/useMediaQuery'
import {
  IconBox, IconChevronLeft, IconChevronRight, IconDashboard, IconKasir, IconLogout,
  IconPie, IconReceipt, IconSliders, IconUser,
} from './Icons.jsx'

// Laptop/tablet: sidebar yang bisa dikecilkan. HP: bar ikon di bawah.
const WIDE = '(min-width: 900px)'
const PREF_KEY = 'mmg-sidebar'

// Kasir hanya mendapat Kasir dan Transaksi; admin toko mendapat semuanya.
const NAV = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true, adminOnly: true },
  { to: '/kasir', label: 'Kasir', icon: IconKasir },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/barang', label: 'Barang', icon: IconBox, adminOnly: true },
  { to: '/bagi-hasil', label: 'Bagi Hasil', icon: IconPie, adminOnly: true },
  { to: '/pengaturan', label: 'Pengaturan', icon: IconSliders, adminOnly: true, desktopOnly: true },
]

function readPref() {
  try {
    return localStorage.getItem(PREF_KEY) === 'closed'
  } catch {
    return false
  }
}

const roleLabel = (isPlatformOwner, role) => (isPlatformOwner ? 'Owner' : role === 'admin' ? 'Admin' : 'Kasir')

function LocalBanner() {
  const { user } = useStore()
  return (
    <p className="local-banner" role="status">
      Mode lokal — masuk sebagai <b>{user.nama}</b>;{' '}
      {usingClone() ? <b>data CLONE production</b> : 'data contoh'} tersimpan di browser ini (tanpa Supabase, production tidak tersentuh).
      {' '}Ganti pengguna:{' '}
      {Object.entries(LOCAL_USERS).map(([key, u]) => (
        <a key={key} href={`?sebagai=${key}`}>{u.nama}</a>
      )).reduce((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}
      {cloneAvailable() && (
        <>{' · '}<a href={usingClone() ? '?data=contoh' : '?data=prod'}>{usingClone() ? 'Pakai data contoh' : 'Pakai clone production'}</a></>
      )}
      {' · '}
      <button
        type="button"
        className="link"
        onClick={() => {
          if (window.confirm('Kembalikan data contoh ke kondisi awal? Semua perubahan lokal (kedua toko) akan hilang.')) {
            resetLocalData()
            window.location.reload()
          }
        }}
      >
        Reset data
      </button>
    </p>
  )
}

// Satu toko = nama saja; owner dengan beberapa toko = pilihan toko ("masuk ke toko siapa").
function StoreSwitcher({ className = '' }) {
  const { stores, store, selectStore } = useStore()
  if (stores.length < 2) return <span className={`store-name ${className}`}>{store.nama}</span>
  return (
    <label className={`store-switch ${className}`}>
      <span className="sr-only">Pilih toko</span>
      <select value={store.id} onChange={(e) => selectStore(e.target.value)}>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.nama}</option>)}
      </select>
    </label>
  )
}

function Sidebar({ items, collapsed, onToggle }) {
  const { user, store, role, isPlatformOwner, signOut } = useStore()
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-head">
        <span className="brand-mark" aria-hidden="true">S</span>
        <strong className="brand-name">Squishy Zoyu</strong>
        <button type="button" className="icon-btn toggle" onClick={onToggle}
          aria-label={collapsed ? 'Lebarkan menu' : 'Kecilkan menu'} aria-expanded={!collapsed}>
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
        </button>
      </div>
      <div className="store-box">
        {collapsed
          ? <span className="store-chip" title={store.nama}>{store.kode.slice(0, 2)}</span>
          : <StoreSwitcher />}
      </div>
      <nav aria-label="Menu utama">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-item" title={collapsed ? label : undefined}>
            <Icon />
            <span className="label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        <p className="who" title={`${user.nama} · ${roleLabel(isPlatformOwner, role)}`}>
          <IconUser />
          <span className="label">{user.nama} · {roleLabel(isPlatformOwner, role)}</span>
        </p>
        {!LOCAL_MODE && (
          <button type="button" className="nav-item" onClick={signOut} title={collapsed ? 'Keluar' : undefined}>
            <IconLogout />
            <span className="label">Keluar</span>
          </button>
        )}
      </div>
    </aside>
  )
}

function AccountMenu() {
  const { user, role, isAdmin, isPlatformOwner, signOut } = useStore()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="account">
      <button type="button" className="account-btn" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <IconUser /> {user.nama}
      </button>
      {open && (
        <>
          <button type="button" className="backdrop" aria-label="Tutup menu akun" onClick={() => setOpen(false)} />
          <div className="account-panel" role="menu">
            <p className="muted">{user.nama} · {roleLabel(isPlatformOwner, role)}</p>
            {isAdmin && (
              <NavLink to="/pengaturan" role="menuitem" className="nav-item"><IconSliders /> Pengaturan</NavLink>
            )}
            {!LOCAL_MODE && (
              <button type="button" role="menuitem" className="nav-item" onClick={signOut}><IconLogout /> Keluar</button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function Layout() {
  const { isAdmin, store } = useStore()
  const wide = useMediaQuery(WIDE)
  const { pathname } = useLocation()
  const [pref, setPref] = useState(readPref)
  const [openOnKasir, setOpenOnKasir] = useState(false)

  // Di Kasir sidebar otomatis mengecil (ruang untuk keranjang), kecuali dibuka manual.
  const onKasir = pathname.startsWith('/kasir')
  useEffect(() => setOpenOnKasir(false), [pathname])
  const collapsed = onKasir && !openOnKasir ? true : pref

  function toggle() {
    if (onKasir && collapsed) {
      setOpenOnKasir(true)
      return
    }
    const next = !pref
    setPref(next)
    try {
      localStorage.setItem(PREF_KEY, next ? 'closed' : 'open')
    } catch {
      // abaikan: pilihan tidak tersimpan, aplikasi tetap jalan
    }
  }

  const items = NAV.filter((i) => isAdmin || !i.adminOnly)
  // key = toko: pindah toko memuat ulang halaman dari nol (tidak ada data toko lama tersisa)
  const page = <main className="content"><Outlet key={store.id} /></main>

  if (wide) {
    return (
      <div className="shell wide">
        <Sidebar items={items} collapsed={collapsed} onToggle={toggle} />
        <div className="main">
          {LOCAL_MODE && <LocalBanner />}
          {page}
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Squishy Zoyu</strong>
        <StoreSwitcher className="on-brand" />
        <AccountMenu />
      </header>
      {LOCAL_MODE && <LocalBanner />}
      {page}
      <nav className="bottomnav" aria-label="Menu utama">
        {items.filter((i) => !i.desktopOnly).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
