import { useEffect, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { LOCAL_MODE } from '../lib/mode'
import { resetLocalData } from '../lib/data'
import { LOW_STOCK_THRESHOLD } from '../lib/format'

export default function PengaturanUmum() {
  const { api, user, store, role, isPlatformOwner } = useStore()
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.fetchSettings().then(setSettings).catch(() => setError('Gagal memuat pengaturan.'))
  }, [api])

  return (
    <section>
      {error && <p className="error" role="alert">{error}</p>}

      <h2>Akun</h2>
      <p>{user.nama} · {isPlatformOwner ? 'Owner' : role === 'admin' ? 'Admin toko' : 'Kasir'}</p>
      <p className="muted">Toko aktif: <b>{store.nama}</b> (kode {store.kode}). Data tiap toko terpisah penuh.</p>

      <h2>Pembagian</h2>
      {!settings ? <p role="status">Memuat…</p> : (
        <dl className="kv">
          <dt>Toko</dt><dd>{settings.nama_toko}</dd>
          <dt>Bagian 25%</dt><dd>{settings.pct_bagian_25}% dari dasar hitung</dd>
          <dt>Bagian 75%</dt><dd>sisanya ({100 - Number(settings.pct_bagian_25)}%)</dd>
          <dt>Dasar hitung</dt><dd>{settings.dasar_pembagian === 'omzet' ? 'Omzet (belum dikonfirmasi)' : settings.dasar_pembagian}</dd>
        </dl>
      )}
      <p className="muted">
        Persen dan dasar hitung sengaja tidak bisa diubah dari sini: mengubahnya menghitung ulang
        seluruh riwayat toko ini. Setelah aturannya dikonfirmasi, perubahan dilakukan sekali lewat database.
      </p>

      <h2>Lainnya</h2>
      <dl className="kv">
        <dt>Stok “menipis”</dt><dd>≤ {LOW_STOCK_THRESHOLD} unit</dd>
        <dt>Zona waktu</dt><dd>Asia/Jakarta</dd>
        <dt>Penyimpanan data</dt><dd>{LOCAL_MODE ? 'Mode lokal (di browser ini)' : 'Supabase'}</dd>
      </dl>

      {LOCAL_MODE && (
        <button type="button" className="danger-outline" onClick={() => {
          if (window.confirm('Kembalikan data contoh ke kondisi awal? Semua perubahan, transaksi, dan setoran lokal akan hilang.')) {
            resetLocalData()
            window.location.reload()
          }
        }}>
          Reset data contoh
        </button>
      )}
    </section>
  )
}
