import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../lib/store.jsx'

// Grup "Barang": sub-tab di dalam halaman (bukan dropdown, supaya enak di HP).
export default function Barang() {
  const { isPlatformOwner } = useStore()
  return (
    <section>
      <h1>Barang</h1>
      <nav className="subtabs" aria-label="Barang">
        <NavLink to="/barang/master">Master Barang</NavLink>
        <NavLink to="/barang/stok">Stok Barang</NavLink>
        <NavLink to="/barang/keluar">Barang Keluar</NavLink>
        {isPlatformOwner && <NavLink to="/barang/transfer">Transfer Stok</NavLink>}
      </nav>
      <Outlet />
    </section>
  )
}
