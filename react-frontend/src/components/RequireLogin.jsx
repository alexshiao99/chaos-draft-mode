import { Navigate, Outlet } from 'react-router-dom'
import { getLoggedInPlayer } from '../hooks/useAuth'

export default function RequireLogin() {
  const player = getLoggedInPlayer()
  if (!player) return <Navigate to="/login" replace />
  return <Outlet />
}
