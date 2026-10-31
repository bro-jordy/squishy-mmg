// CSV untuk Excel/Sheets berlokal Indonesia: pemisah ';' dan BOM agar UTF-8 terbaca.
const esc = (v) => {
  const t = String(v ?? '')
  return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t
}

export function toCsv(lines) {
  return `﻿${lines.map((l) => l.map(esc).join(';')).join('\r\n')}\r\n`
}

export function downloadCsv(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
