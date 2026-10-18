import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { LOCAL_MODE } from '../lib/mode'

const ROLE_LABEL = { admin: 'Admin', kasir: 'Kasir' }

// Pengguna toko aktif. Login (email + password) dibuat di Supabase; di sini akun itu
// didaftarkan ke toko dan diberi peran. Admin toko mengelola kasir; menjadikan seseorang
// admin hanya bisa oleh owner platform.
export default function Pengguna() {
  const { api, user, store, isPlatformOwner } = useStore()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ email: '', nama: '', role: 'kasir' })
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api.listMembers())
      setError('')
    } catch {
      setError('Gagal memuat pengguna. Coba muat ulang.')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onAdd(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setFormError('')
    try {
      await api.addMember(form)
      setNotice(`${form.email.trim()} ditambahkan sebagai ${ROLE_LABEL[form.role]} di ${store.nama}`)
      setForm({ email: '', nama: '', role: 'kasir' })
      await load()
    } catch (err) {
      setFormError(err.message || 'Gagal menambahkan. Coba lagi.')
    }
    setBusy(false)
  }

  async function change(m, patch) {
    setNotice('')
    setFormError('')
    try {
      await api.setMember({ userId: m.user_id, role: patch.role ?? m.role, active: patch.active ?? m.is_active })
      setNotice(`${m.nama}: perubahan disimpan`)
      await load()
    } catch (err) {
      setFormError(err.message || 'Gagal menyimpan. Coba lagi.')
    }
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!rows) return <p role="status">Memuat pengguna…</p>

  return (
    <section>
      <h2>Pengguna {store.nama}</h2>
      <p className="muted">
        Kasir hanya mendapat menu Kasir dan Transaksi (hanya transaksi buatannya sendiri).
        Kasir yang dinonaktifkan tidak bisa masuk, tapi riwayat transaksinya tetap ada.
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {formError && <p className="error" role="alert">{formError}</p>}

      <ul className="members">
        {rows.map((m) => {
          const locked = !isPlatformOwner && m.role === 'admin'
          const self = m.user_id === user.id
          return (
            <li key={m.user_id} className={`card ${m.is_active ? '' : 'inactive'}`}>
              <div>
                <b>{m.nama}</b> {self && <span className="muted">(Anda)</span>}
                <br /><small className="muted">{m.email ?? '—'}</small>
              </div>
              <div className="member-meta">
                <span className={`badge role-${m.role}`}>{ROLE_LABEL[m.role]}</span>{' '}
                <span className={`badge ${m.is_active ? 'st-ok' : 'st-void'}`}>{m.is_active ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className="member-actions">
                {locked ? (
                  <small className="muted">Hanya owner platform yang bisa mengubah admin</small>
                ) : (
                  <>
                    {isPlatformOwner && (
                      <label className="inline">
                        <span className="sr-only">Peran {m.nama}</span>
                        <select value={m.role} onChange={(e) => change(m, { role: e.target.value })}>
                          <option value="kasir">Kasir</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                    )}
                    <button type="button" className="small" disabled={self && !isPlatformOwner && m.is_active}
                      onClick={() => change(m, { active: !m.is_active })}>
                      {m.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {rows.length === 0 && <p className="muted">Belum ada pengguna terdaftar.</p>}

      <h2>Tambah pengguna</h2>
      <p className="muted">
        {LOCAL_MODE
          ? 'Mode lokal: akun disimulasikan. Di Supabase, buat dulu login-nya di Authentication → Users, lalu tambahkan emailnya di sini.'
          : 'Buat dulu login-nya di Supabase (Authentication → Users), lalu tambahkan emailnya di sini.'}
      </p>
      <form className="card form" onSubmit={onAdd}>
        <label>
          Email login
          <input type="email" required value={form.email} onChange={set('email')} autoComplete="off" />
        </label>
        <label>
          Nama (opsional)
          <input value={form.nama} onChange={set('nama')} maxLength={60} />
        </label>
        <label>
          Peran
          <select value={form.role} onChange={set('role')}>
            <option value="kasir">Kasir (menu Kasir & Transaksi)</option>
            {isPlatformOwner && <option value="admin">Admin toko (semua menu toko)</option>}
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Menambahkan…' : 'Tambah ke toko ini'}</button>
      </form>
    </section>
  )
}
