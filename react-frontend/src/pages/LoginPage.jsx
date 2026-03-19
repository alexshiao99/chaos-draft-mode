import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLoggedInPlayer, setLoggedInPlayer } from '../hooks/useAuth'

export default function LoginPage() {
  const navigate = useNavigate()
  const [players, setPlayers] = useState([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // If already logged in, redirect to home
  useEffect(() => {
    if (getLoggedInPlayer()) navigate('/', { replace: true })
  }, [navigate])

  useEffect(() => {
    fetch('/api/players')
      .then((r) => r.json())
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) {
          setPlayers(list)
          setSelected(list[0])
        } else {
          setError('No players found.')
        }
      })
      .catch(() => setError('Failed to load players.'))
      .finally(() => setLoading(false))
  }, [])

  function handleLogin(e) {
    e.preventDefault()
    if (!selected) return
    setLoggedInPlayer(selected)
    navigate('/')
  }

  return (
    <>
      <header>
        <span className="header-title">⚔️ CHAOS Draft</span>
      </header>
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
        <div id="setup-screen">
          <h2>Select Your Player</h2>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading players...</div>
          ) : error ? (
            <div className="error-msg">{error}</div>
          ) : (
            <form onSubmit={handleLogin}>
              <div className="field">
                <label>Who are you?</label>
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  {players.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-gold" style={{ width: '100%', marginTop: '1rem' }}>
                Log In
              </button>
            </form>
          )}
        </div>
      </main>
    </>
  )
}
