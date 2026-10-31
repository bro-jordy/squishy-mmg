// Struk sebagai gambar PNG (digambar di canvas, tanpa library) untuk dibagikan ke WhatsApp dsb.
// Isinya sama dengan struk di layar: tanpa no. transaksi dan nama kasir.
import { formatDateTimeJakarta, formatRupiah } from './format.js'

const METHOD = { cash: 'Tunai', qris: 'QRIS' }
const W = 420 // lebar logis (px); digambar 2x supaya tajam
const PAD = 28
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

function wrap(ctx, text, maxWidth) {
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

// rows: daftar perintah gambar; dihitung dulu agar tinggi kanvas pas.
function layout(ctx, sale, title, statusLabel) {
  const rows = []
  const inner = W - PAD * 2
  const text = (str, o = {}) => rows.push({ type: 'text', str, ...o })
  const gap = (h) => rows.push({ type: 'gap', h })
  const rule = () => rows.push({ type: 'rule' })

  text(title, { size: 22, weight: 700, align: 'center', h: 30 })
  gap(4)
  text(formatDateTimeJakarta(sale.sold_at), { size: 13, color: '#555', align: 'center', h: 20 })
  if (sale.customer_name) text(`Pembeli: ${sale.customer_name}`, { size: 13, color: '#555', align: 'center', h: 20 })
  gap(10)
  rule()
  gap(10)

  for (const it of sale.sale_items) {
    ctx.font = `600 15px ${FONT}`
    const nameLines = wrap(ctx, it.product_name, inner - 110)
    nameLines.forEach((l, i) => text(l, { size: 15, weight: 600, h: 21, right: i === 0 ? formatRupiah(it.line_total) : null }))
    ctx.font = `13px ${FONT}`
    wrap(ctx, `${it.variant_label} · ${it.qty} × ${formatRupiah(it.unit_price)}`, inner)
      .forEach((l) => text(l, { size: 13, color: '#666', h: 19 }))
    gap(8)
  }

  rule()
  gap(8)
  text('Total', { size: 18, weight: 700, h: 28, right: formatRupiah(sale.total) })
  gap(4)
  text(`Bayar: ${sale.payment_method ? `${METHOD[sale.payment_method]} · ` : ''}${statusLabel}`, { size: 13, color: '#555', h: 20 })
  if (sale.status === 'void') text(`Alasan void: ${sale.void_reason}`, { size: 13, color: '#555', h: 20 })
  gap(14)
  text('Terima kasih!', { size: 15, weight: 600, align: 'center', h: 24 })
  return rows
}

// Mengembalikan Blob PNG struk. statusLabel mis. 'Selesai' / 'Belum dibayar'.
export function renderReceiptBlob(sale, { title, statusLabel }) {
  const probe = document.createElement('canvas').getContext('2d')
  const rows = layout(probe, sale, title, statusLabel)
  const height = PAD * 2 + rows.reduce((n, r) => n + (r.type === 'text' ? r.h : r.type === 'rule' ? 1 : r.h), 0)

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, height)
  ctx.fillStyle = '#111'
  ctx.textBaseline = 'middle'

  let y = PAD
  for (const r of rows) {
    if (r.type === 'gap') {
      y += r.h
    } else if (r.type === 'rule') {
      ctx.fillStyle = '#bbb'
      ctx.fillRect(PAD, y, W - PAD * 2, 1)
      y += 1
    } else {
      ctx.font = `${r.weight ?? 400} ${r.size}px ${FONT}`
      ctx.fillStyle = r.color ?? '#111'
      const mid = y + r.h / 2
      if (r.align === 'center') {
        ctx.textAlign = 'center'
        ctx.fillText(r.str, W / 2, mid)
      } else {
        ctx.textAlign = 'left'
        ctx.fillText(r.str, PAD, mid)
        if (r.right) {
          ctx.textAlign = 'right'
          ctx.fillText(r.right, W - PAD, mid)
        }
      }
      y += r.h
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal membuat gambar struk'))), 'image/png'))
}

// Bagikan lewat menu share HP (ada WhatsApp); kalau tidak didukung: salin gambar ke clipboard;
// kalau itu pun tidak bisa: unduh file. Mengembalikan 'shared' | 'copied' | 'downloaded' | 'cancelled'.
export async function shareReceipt(blob) {
  const file = new File([blob], 'struk-squishy-zoyu.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return 'copied'
    }
  } catch { /* lanjut ke unduh */ }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
