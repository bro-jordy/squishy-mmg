import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
    <form className="login card" onSubmit={onSubmit}>
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
  )
}
