// Mode lokal: data contoh dari src/data/local-seed.json, tanpa Supabase & tanpa login.
// Dijalankan lewat `npm run dev:local` (file .env.offline). Nilai ini konstanta saat
// build, jadi kode mode lokal tidak ikut ke build produksi.
export const LOCAL_MODE = import.meta.env.VITE_DATA_MODE === 'local'
