import { useNavigate } from 'react-router-dom'

const STORAGE_KEY = 'chaos_draft_player'

export function getLoggedInPlayer() {
  return localStorage.getItem(STORAGE_KEY) || null
}

export function setLoggedInPlayer(name) {
  localStorage.setItem(STORAGE_KEY, name)
}

export function clearLoggedInPlayer() {
  localStorage.removeItem(STORAGE_KEY)
}

export default function useAuth() {
  const navigate = useNavigate()
  const player = getLoggedInPlayer()

  function logout() {
    clearLoggedInPlayer()
    navigate('/login')
  }

  return { player, logout }
}
