const API_BASE = import.meta.env.VITE_API_URL || ''

export const tokenKey = (lobbyId) => `draft_token_${lobbyId}`
export const roleKey = (lobbyId) => `draft_role_${lobbyId}`

export async function apiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
}

export async function draftFetch(lobbyId, path, options = {}) {
  const token = localStorage.getItem(tokenKey(lobbyId))
  return apiFetch(`/api/${lobbyId}${path}`, {
    ...options,
    headers: {
      ...(token ? { 'X-Player-Token': token } : {}),
      ...options.headers,
    },
  })
}
