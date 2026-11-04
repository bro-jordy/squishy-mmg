import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth.jsx'

const MAX_PULL = 120
const TRIGGER = 45
const TAP_PULL = 60
const CORD_BASE = 70

// Tali lampu: tarik atau ketuk gagangnya untuk menyalakan/mematikan lampu (form login muncul/tertutup).
// Gerak balik memakai transisi CSS (bukan loop animasi), jadi tali selalu kembali ke posisi awal.
function PullCord({ onToggle, lit }) {
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  const timer = useRef(0)

  useEffect(() => () => clearTimeout(timer.current), [])

  function tug() {
    clearTimeout(timer.current)
    setPull(TAP_PULL)
    timer.current = setTimeout(() => setPull(0), 130)
  }

  function onPointerDown(e) {
    clearTimeout(timer.current)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY - pull, moved: false }
    setDragging(true)
  }

  function onPointerMove(e) {
    if (!drag.current) return
    const next = Math.min(Math.max(e.clientY - drag.current.startY, 0), MAX_PULL)
    if (next > 4) drag.current.moved = true
    setPull(next)
  }

  function release() {
    if (!drag.current) return
    const { moved } = drag.current
    drag.current = null
    setDragging(false)
    // Ketukan tanpa geser dianggap tarikan juga, supaya mudah di layar sentuh.
    if (pull > TRIGGER || !moved) onToggle()
    if (moved) setPull(0)
    else tug()
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onToggle()
    tug()
  }

  const motion = dragging ? 'none' : pull === 0 ? 'spring' : 'tap'
  const len = CORD_BASE + pull

  return (
    <div className={`cord-wrap motion-${motion}`}>
      <div className="cord" style={{ height: len }} aria-hidden="true" />
      <button
        type="button"
        className="cord-bead"
        style={{ top: len }}
        aria-label={lit ? 'Tarik tali untuk mematikan lampu dan menutup form login' : 'Tarik tali untuk menyalakan lampu dan membuka form login'}
        aria-pressed={lit}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={onKeyDown}
      />
      {!lit && <span className="cord-hint" aria-hidden="true">pull me</span>}
    </div>
  )
}

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lit, setLit] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const { error: err } = await signIn(email.trim(), password)
    if (err) setError('Email atau password salah.')
    setBusy(false)
  }

  return (
    <div className={`login-stage${lit ? ' lit' : ''}`}>
      <div className="lamp">
        <div className="lamp-shade" />
        <div className="lamp-bulb" />
        <div className="lamp-beam" />
      </div>
      <PullCord lit={lit} onToggle={() => setLit((v) => !v)} />
      <form className="login card login-form" onSubmit={onSubmit} inert={lit ? undefined : ''} aria-hidden={!lit}>
          <h1>Squishy Zoyu</h1>
          <label>
            Email
            <input type="email" autoComplete="username" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Masuk…' : 'Masuk'}
          </button>
      </form>
    </div>
  )
}
