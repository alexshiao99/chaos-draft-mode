import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch, tokenKey, roleKey } from '../api'

export default function JoinPage() {
  const { lobbyId } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState(null)

  useEffect(() => {
    // Already joined as P2 (double-click / retry) — go straight to draft
    const existingRole = localStorage.getItem(roleKey(lobbyId))
    if (existingRole === '2') {
      navigate(`/draft/${lobbyId}`, { replace: true })
      return
    }
    // P1 opening the join link in same browser — redirect to draft (they're already in)
    if (existingRole === '1') {
      navigate(`/draft/${lobbyId}`, { replace: true })
      return
    }

    apiFetch(`/api/${lobbyId}/join`, { method: "POST" })
      .then(async (res) => {
        if (res.status === 404) { setError("Lobby not found or expired."); return }
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}))
          setError(body.error === 'ai_lobby'
            ? "This is an AI Draft lobby — no second player needed."
            : "This lobby is already full.")
          return
        }
        if (!res.ok) { setError("Failed to join lobby."); return }
        const data = await res.json()
        localStorage.setItem(tokenKey(lobbyId), data.p2_token)
        localStorage.setItem(roleKey(lobbyId), "2")
        navigate(`/draft/${lobbyId}`, { replace: true, state: { draft: data } })
      })
      .catch(() => setError("Network error — could not reach the server."))
  }, [lobbyId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header>
        <span className="header-title">CHAOS Draft</span>
      </header>
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        {error ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.2rem', color: 'var(--loss)', marginBottom: '1rem' }}>{error}</div>
            <button className="btn btn-gold" onClick={() => navigate('/')}>Back to Home</button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>Joining lobby...</div>
            <div style={{ fontSize: '.85rem' }}>Please wait</div>
          </div>
        )}
      </main>
    </>
  )
}
