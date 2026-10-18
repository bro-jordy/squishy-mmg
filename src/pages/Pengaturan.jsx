import { NavLink, Outlet } from 'react-router-dom'

// Grup "Pengaturan": sub-tab Umum | Pengguna.
export default function Pengaturan() {
  return (
    <section>
      <h1>Pengaturan</h1>
      <nav className="subtabs" aria-label="Pengaturan">
        <NavLink to="/pengaturan/umum">Umum</NavLink>
        <NavLink to="/pengaturan/pengguna">Pengguna</NavLink>
      </nav>
      <Outlet />
    </section>
  )
}
