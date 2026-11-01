import { useEffect, useId, useRef } from 'react'

// Dialog modal bawaan browser (fokus terkunci, Esc menutup). Induk me-render
// komponen ini hanya saat dialog harus tampil, dan menutup lewat onClose.
export default function Modal({ title, onClose, className = '', showClose = false, children }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  return (
    <dialog ref={ref} className={`dialog ${className}`.trim()} onClose={onClose} aria-labelledby={titleId}>
      {/* fokus awal di judul: Enter tidak sengaja menekan tombol aksi */}
      <h2 id={titleId} tabIndex={-1} autoFocus>{title}</h2>
      {showClose && <button type="button" className="dialog-x no-print" aria-label="Tutup" onClick={() => ref.current?.close()}>✕</button>}
      {children}
    </dialog>
  )
}
