import { useStore } from '../lib/store.jsx'

// Hanya tampilan. Akses data yang sebenarnya dijaga RLS dan fungsi di database.
export default function AdminOnly({ title, children }) {
  const { isAdmin } = useStore()
  if (isAdmin) return children
  return (
    <section>
      <h1>{title}</h1>
      <p>Halaman ini hanya untuk admin toko.</p>
    </section>
  )
}
