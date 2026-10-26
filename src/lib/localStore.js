import { initState } from './stockLogic.js'

// Penyimpanan mode lokal di browser (localStorage). Bisa gagal (mode privat / diblokir),
// maka semua akses dibungkus try/catch dan aplikasi tetap jalan di memori.
// Isinya wadah multi-toko: { stores, states: { [storeId]: state toko } } — tiap toko punya
// master barang, stok, transaksi, setoran, dan pengguna sendiri (terpisah penuh).
const KEY = 'mmg-local-v4'
const CLONE_KEY = 'mmg-clone-v1'

// Data clone production (scripts/build_prod_clone.py) membawa `states` sendiri.
const isClone = (seed) => Boolean(seed.states)
const keyOf = (seed) => (isClone(seed) ? CLONE_KEY : KEY)

// Jika data contoh (seed) berubah, simpanan lama dianggap kadaluarsa dan di-reset.
const fingerprint = (seed) =>
  isClone(seed) ? String(seed.dibuat_dari) : `${seed.stores.length}:${seed.variants.length}:${seed.variants.reduce((n, v) => n + v.stock, 0)}`

const MEMBERS = {
  REA: [
    { user_id: 'u-rea', nama: 'Rea', email: 'rea@lokal.test', role: 'admin', is_active: true },
    { user_id: 'u-kasir', nama: 'Kasir Rea', email: 'kasir@lokal.test', role: 'kasir', is_active: true },
  ],
  SOSO: [{ user_id: 'u-soso', nama: 'Soso', email: 'soso@lokal.test', role: 'admin', is_active: true }],
}

// Toko pertama memakai master barang + Stock Awal dari sheet; toko lain KOSONG (barangnya
// ditambahkan lewat Master Barang).
export function initContainer(seed, now = new Date()) {
  if (isClone(seed)) return structuredClone({ stores: seed.stores, states: seed.states, transfers: seed.transfers ?? [] })
  const states = {}
  seed.stores.forEach((store, i) => {
    const s = i === 0 ? seed : { ...seed, products: [], variants: [] }
    states[store.id] = { ...initState(s, now), members: MEMBERS[store.kode] ?? [] }
  })
  return { stores: seed.stores, states }
}

const valid = (c) =>
  c && Array.isArray(c.stores) && c.states &&
  c.stores.every((s) => {
    const st = c.states[s.id]
    return st && Array.isArray(st.movements) && Array.isArray(st.products) &&
      Array.isArray(st.variants) && Array.isArray(st.sales) && Array.isArray(st.settlements) &&
      Array.isArray(st.members)
  })

export function loadContainer(seed) {
  try {
    const raw = localStorage.getItem(keyOf(seed))
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved.fp === fingerprint(seed) && valid(saved.container)) return saved.container
    }
  } catch {
    // abaikan: pakai data baru
  }
  return initContainer(seed)
}

export function saveContainer(seed, container) {
  try {
    localStorage.setItem(keyOf(seed), JSON.stringify({ fp: fingerprint(seed), container }))
  } catch {
    // abaikan: data tetap ada di memori selama tab terbuka
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(CLONE_KEY)
  } catch {
    // abaikan
  }
}
