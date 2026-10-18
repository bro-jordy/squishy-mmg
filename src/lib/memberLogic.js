// Pengguna toko untuk MODE LOKAL. Padanan add_member() / set_member() / list_members()
// di db/schema.sql (ubah keduanya bersamaan). Admin toko hanya mengelola KASIR; menjadikan
// seseorang admin hanya bisa oleh owner platform. Login-nya sendiri dibuat di Supabase.
export class MemberError extends Error {}

const ROLES = ['admin', 'kasir']

// actor: { isOwner, userId }
export function listMembers(state) {
  return [...state.members].sort((a, b) =>
    (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || a.nama.localeCompare(b.nama, 'id'))
}

export function addMember(state, { email, nama, role }, actor) {
  const e = String(email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new MemberError('Email tidak valid')
  if (!ROLES.includes(role)) throw new MemberError(`Peran tidak valid: ${role}`)
  if (role === 'admin' && !actor.isOwner) throw new MemberError('Hanya owner platform yang boleh menjadikan admin')
  const existing = state.members.find((m) => m.email === e)
  if (existing?.role === 'admin' && !actor.isOwner) {
    throw new MemberError('Akun ini hanya bisa diubah oleh owner platform')
  }
  if (existing) {
    return { ...state, members: state.members.map((m) => (m === existing ? { ...m, role, is_active: true } : m)) }
  }
  const row = { user_id: `u-${e}`, nama: String(nama ?? '').trim() || e.split('@')[0], email: e, role, is_active: true }
  return { ...state, members: [...state.members, row] }
}

export function setMember(state, { userId, role, active }, actor) {
  if (!ROLES.includes(role)) throw new MemberError(`Peran tidak valid: ${role}`)
  const m = state.members.find((x) => x.user_id === userId)
  if (!m) throw new MemberError('Pengguna tidak terdaftar di toko ini')
  if (!actor.isOwner) {
    if (m.role === 'admin' || role === 'admin') throw new MemberError('Admin hanya bisa mengelola kasir')
    if (userId === actor.userId && !active) throw new MemberError('Tidak bisa menonaktifkan akun sendiri')
  }
  return { ...state, members: state.members.map((x) => (x === m ? { ...x, role, is_active: active ?? x.is_active } : x)) }
}
