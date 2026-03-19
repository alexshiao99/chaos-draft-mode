import { BrowserRouter, Routes, Route } from 'react-router-dom'
import RequireLogin from './components/RequireLogin'
import LoginPage from './pages/LoginPage'
import LandingPage from './pages/LandingPage'
import DraftPage from './pages/DraftPage'
import JoinPage from './pages/JoinPage'
import PlayerStatsPage from './pages/PlayerStatsPage'
import CardDetailPage from './pages/CardDetailPage'
import CardStatsPage from './pages/CardStatsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireLogin />}>
          <Route path="/"                        element={<LandingPage />} />
          <Route path="/draft/:lobbyId/join"     element={<JoinPage />} />
          <Route path="/draft/:lobbyId"          element={<DraftPage />} />
          <Route path="/player_stats"            element={<PlayerStatsPage />} />
          <Route path="/player_stats/:playerName" element={<PlayerStatsPage />} />
          <Route path="/card/:cardName"          element={<CardDetailPage />} />
          <Route path="/stats"                   element={<CardStatsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
