import { NavLink, Outlet } from 'react-router-dom'

// Grup "Barang": dua sub-tab di dalam halaman (bukan dropdown, supaya enak di HP).
export default function Barang() {
  return (
    <section>
      <h1>Barang</h1>
      <nav className="subtabs" aria-label="Barang">
        <NavLink to="/barang/master">Master Barang</NavLink>
        <NavLink to="/barang/stok">Stok Barang</NavLink>
      </nav>
      <Outlet />
    </section>
  )
}
