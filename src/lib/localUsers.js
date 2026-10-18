// Pengguna contoh untuk MODE LOKAL. Pilih lewat alamat: ?sebagai=owner|rea|soso|kasir
//   owner = owner platform (bisa masuk kedua toko)   rea  = admin Toko Rea
//   soso  = admin Toko Soso                          kasir = kasir Toko Rea
export const LOCAL_USERS = {
  owner: { id: 'u-owner', nama: 'Owner', is_platform_owner: true },
  rea: { id: 'u-rea', nama: 'Rea', is_platform_owner: false },
  soso: { id: 'u-soso', nama: 'Soso', is_platform_owner: false },
  kasir: { id: 'u-kasir', nama: 'Kasir Rea', is_platform_owner: false },
}

export function localUserKey() {
  const k = new URLSearchParams(window.location.search).get('sebagai')
  return k && k in LOCAL_USERS ? k : 'owner'
}
