# Plan: Multiplayer Shared State for Chaos Draft Mode

## Context

Currently, the draft app is single-machine only — both players sit at the same computer. This plan adds the ability for two players on separate computers to draft against each other in real time by sharing a draft link. Player 1 creates a lobby, shares the link with Player 2, and both players draft live against each other from different devices.

Deployment target: React frontend on AWS Amplify, Flask backend on EC2.

### Known Limitations
- Player tokens are stored in `localStorage`. If a player switches to a different device or browser, they lose their token and cannot reconnect. **Use the same browser you joined with.**
- In-memory lobby state is lost on EC2 restart. Acceptable for a friend-group app.

---

## User-Facing Flow

1. P1 fills out the existing setup form (both player names, modifiers, etc.) and clicks "Start Draft"
2. Instead of immediately entering the draft, P1 sees a **lobby waiting screen** with:
   - A shareable link: `https://yourapp.com/draft/{lobbyId}/join`
   - A QR code of that link (using the already-installed `QRCode.react`)
   - A "Copy Link" button
3. P2 opens that link on their device → automatically joins → both are redirected to the draft
4. The draft proceeds in real-time with each player seeing the other's picks within ~1.5 seconds

---

## Real-Time Sync: HTTP Polling

**Not WebSockets or SSE** — both add complexity (eventlet/gevent, sticky sessions) that is not worth it for a turn-based draft with 10–30s average think times. The existing `GET /api/{lobby_id}/state` endpoint already handles this. Zero new dependencies.

**Polling rate:** 5s when `status === "waiting_for_p2"`, 1.5s when `status === "active"`.

---

## Phase 1: Backend — Token Identity, Turn Enforcement, Lobby Pruning

**File: `backend/draft.py`**

### 1a. Verify `action_index` convention before implementing `get_whose_turn`

**Critical:** Before writing any turn logic, check whether `action_index` resets to 0 at the start of the pick phase, or continues incrementing from 4. Find the ban→pick phase transition in `backend/draft.py`.

- **If it does NOT reset** (continues 0→19): use `action_index - len(BAN_SEQUENCE)` as the index into `PICK_SEQUENCE` during the pick phase.
- **If it resets to 0**: use `action_index` directly into `PICK_SEQUENCE`.

Wrong convention = silent bug where the wrong player is allowed to act.

### 1b. Shared `get_whose_turn` helper

Implement once, use in both `/action` validation and `get_state_view`. Never inline this logic.

```python
def get_whose_turn(lobby):
    """Returns 1 or 2 based on phase and action_index. Returns None if no active turn."""
    phase = lobby["phase"]
    idx = lobby["action_index"]
    if phase == "ban":
        if idx >= len(BAN_SEQUENCE):
            return None
        return BAN_SEQUENCE[idx]
    elif phase == "pick":
        pick_idx = idx - len(BAN_SEQUENCE)  # adjust if action_index doesn't reset
        if pick_idx < 0 or pick_idx >= len(PICK_SEQUENCE):
            return None
        return PICK_SEQUENCE[pick_idx]
    return None  # "done" or unknown phase
```

### 1c. Lobby dict additions in `/api/start`

```python
import secrets, threading, time

lobbies[lobby_id] = {
    # ... existing fields unchanged ...
    "p1_token":   secrets.token_hex(8),
    "p2_token":   None,
    "status":     "waiting_for_p2",  # "waiting_for_p2" | "active" | "complete"
    "created_at": time.time(),
    "_lock":      threading.Lock(),  # NOT returned in API responses
}
```

Status enum has exactly 3 values. `"setup"` is not used.

### 1d. Update `get_state_view(lobby)`

Confirm the existing function takes a single `lobby` dict. Explicitly exclude `_lock`, `p1_token`, `p2_token`, `created_at` from output:

```python
def get_state_view(lobby):
    return {
        # ... existing fields ...
        "status":     lobby["status"],
        "p2_joined":  lobby["p2_token"] is not None,
        "whose_turn": get_whose_turn(lobby),
        # NOT included: p1_token, p2_token, _lock, created_at
    }
```

### 1e. Return `p1_token` from `/api/start`

```python
return jsonify({
    # ... existing fields ...
    "p1_token": lobby["p1_token"],
})
```

### 1f. New endpoint: `POST /api/<lobby_id>/join`

P2's name is already set by P1 at lobby creation. `JoinPage` must check localStorage first — if the token already exists for this lobby, skip the request and navigate directly to the draft (handles double-click/retry).

```python
@draft_bp.route("/api/<lobby_id>/join", methods=["POST"])
def join_lobby(lobby_id):
    lobby = lobbies.get(lobby_id)
    if not lobby:
        return jsonify({"error": "lobby_not_found"}), 404

    with lobby["_lock"]:
        if lobby["status"] != "waiting_for_p2":
            return jsonify({"error": "lobby_full"}), 403
        lobby["p2_token"] = secrets.token_hex(8)
        lobby["status"] = "active"

    return jsonify({
        "p2_token": lobby["p2_token"],
        "lobby_id": lobby_id,
        **get_state_view(lobby),  # full state returned immediately — no extra poll needed
    })
```

- `404 lobby_not_found` — lobby doesn't exist or was pruned
- `403 lobby_full` — a different person already joined as P2

### 1g. Modify `POST /api/<lobby_id>/action` — lock + token validation

```python
with lobby["_lock"]:
    token = request.headers.get("X-Player-Token") or request.json.get("player_token")
    whose_turn = get_whose_turn(lobby)
    if whose_turn is None:
        return jsonify({"error": "no_active_turn"}), 400
    expected = lobby["p1_token"] if whose_turn == 1 else lobby["p2_token"]
    if token != expected:
        return jsonify({"error": "not_your_turn"}), 403
    # ... existing action logic continues inside the lock ...
```

Both the check and the mutation must be inside the lock to prevent double-submission races.

### 1h. Modify `POST /api/<lobby_id>/undo` — allow undo, but only the last-acting player

Undo is kept in multiplayer. To be fair, only the player who made the last action can undo it.

```python
with lobby["_lock"]:
    token = request.headers.get("X-Player-Token") or request.json.get("player_token")
    prev_idx = lobby["action_index"] - 1
    # Determine who made the last action
    if lobby["phase"] == "ban" and prev_idx >= 0:
        last_actor = BAN_SEQUENCE[prev_idx]
    elif lobby["phase"] == "pick":
        pick_prev = prev_idx - len(BAN_SEQUENCE)
        last_actor = PICK_SEQUENCE[pick_prev] if pick_prev >= 0 else None
    else:
        last_actor = None

    if last_actor is None:
        return jsonify({"error": "nothing_to_undo"}), 400
    expected = lobby["p1_token"] if last_actor == 1 else lobby["p2_token"]
    if token != expected:
        return jsonify({"error": "not_your_undo"}), 403
    # ... existing undo logic continues inside the lock ...
```

### 1i. Handle missing lobby in `GET /api/<lobby_id>/state`

```python
if lobby_id not in lobbies:
    return jsonify({"error": "lobby_not_found"}), 404
```

### 1j. Lobby pruning — required, in `main.py`

```python
import threading, time
from backend.draft import lobbies

def prune_lobbies():
    while True:
        time.sleep(1800)  # every 30 minutes
        cutoff = time.time() - (6 * 3600)
        to_delete = [lid for lid, l in list(lobbies.items())
                     if l.get("created_at", 0) < cutoff]
        for lid in to_delete:
            lobbies.pop(lid, None)

threading.Thread(target=prune_lobbies, daemon=True).start()
```

`list(lobbies.items())` snapshots the dict before iterating to avoid `RuntimeError: dictionary changed size during iteration`.

### 1k. CORS — use regex for Amplify domain

`*.amplifyapp.com` as a string literal does NOT work in Flask-CORS. Use `re.compile`:

```python
import re
from flask_cors import CORS

CORS(app, resources={r"/api/*": {
    "origins": [
        "http://localhost:5173",
        re.compile(r"https://.*\.amplifyapp\.com"),
    ],
    "allow_headers": ["Content-Type", "X-Player-Token"]
}})
```

---

## Phase 2: Frontend — Join Flow

### Canonical localStorage key strings

Define as exported functions in `api.js` and use them everywhere — never write key strings inline in components:

```javascript
export const tokenKey = (lobbyId) => `draft_token_${lobbyId}`;
export const roleKey  = (lobbyId) => `draft_role_${lobbyId}`;
```

### 2a. `react-frontend/src/api.js` (new file)

```javascript
const API_BASE = import.meta.env.VITE_API_URL || "";

export const tokenKey = (lobbyId) => `draft_token_${lobbyId}`;
export const roleKey  = (lobbyId) => `draft_role_${lobbyId}`;

export async function apiFetch(path, options = {}) {
    return fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
    });
}

export async function draftFetch(lobbyId, path, options = {}) {
    const token = localStorage.getItem(tokenKey(lobbyId));
    return apiFetch(`/api/${lobbyId}${path}`, {
        ...options,
        headers: {
            ...(token ? { "X-Player-Token": token } : {}),
            ...options.headers,
        },
    });
}
```

### 2b. `react-frontend/src/pages/LandingPage.jsx` (modified)

After `POST /api/start` succeeds:

```javascript
const { lobby_id, p1_token } = await res.json();
localStorage.setItem(tokenKey(lobby_id), p1_token);
localStorage.setItem(roleKey(lobby_id), "1");
setLobbyId(lobby_id);  // triggers waiting screen render
```

**Do NOT navigate to `/draft/{lobbyId}` yet.** Show an inline lobby waiting screen:
- "Waiting for Player 2 to join..."
- Shareable join URL: `${window.location.origin}/draft/${lobby_id}/join`
- "Copy Link" button
- QR code via `QRCode.react` (already installed in the project)

Poll `GET /api/${lobby_id}/state` every 5s. When `status === "active"`, navigate to `/draft/${lobby_id}`.

### 2c. `react-frontend/src/pages/JoinPage.jsx` (new file)

P2 lands here at `/draft/:lobbyId/join`:

```javascript
useEffect(() => {
    // Already joined (double-click, retry) — go straight to draft
    if (localStorage.getItem(tokenKey(lobbyId))) {
        navigate(`/draft/${lobbyId}`);
        return;
    }

    apiFetch(`/api/${lobbyId}/join`, { method: "POST" })
        .then(async (res) => {
            if (res.status === 404) { setError("Lobby not found or expired"); return; }
            if (res.status === 403) { setError("This lobby is already full"); return; }
            const data = await res.json();
            localStorage.setItem(tokenKey(lobbyId), data.p2_token);
            localStorage.setItem(roleKey(lobbyId), "2");
            navigate(`/draft/${lobbyId}`, { state: { draft: data } });
        });
}, [lobbyId]);
```

Show a spinner while in-flight. On error, show a message — no automatic retry.

### 2d. `react-frontend/src/App.jsx` (modified)

Add route: `<Route path="/draft/:lobbyId/join" element={<JoinPage />} />`

---

## Phase 3: Frontend — Polling + Turn State in DraftPage

**File: `react-frontend/src/pages/DraftPage.jsx`** (modified)

### 3a. Role detection — redirect inside `useEffect`

```javascript
const localRole = parseInt(localStorage.getItem(roleKey(lobbyId)), 10) || null;

useEffect(() => {
    if (!localRole) navigate("/");
}, [localRole]);
```

`localRole` is a localStorage read (not a hook — safe outside `useEffect`), but the `navigate` must be inside `useEffect` to follow the rules of hooks.

### 3b. Initial fetch + adaptive polling loop

```javascript
const fetchState = useCallback(async () => {
    const res = await draftFetch(lobbyId, "/state");
    if (res.status === 404) {
        navigate("/", { state: { error: "Lobby expired" } });
        return;
    }
    if (res.status === 403) {
        navigate("/", { state: { error: "Session invalid" } });
        return;
    }
    setDraft(await res.json());
}, [lobbyId]);

useEffect(() => {
    fetchState();  // immediate fetch on mount — no initial delay
    const intervalMs = draft?.status === "active" ? 1500 : 5000;
    const id = setInterval(fetchState, intervalMs);
    return () => clearInterval(id);
}, [lobbyId, draft?.status, fetchState]);
```

> **Note:** `draft?.status` in the dependency array causes the effect to re-run (clearing the old interval and starting a new one) each time the status changes — e.g., when `"waiting_for_p2"` transitions to `"active"`. This is intentional: it switches from the 5s waiting-room poll to the 1.5s active-draft poll. The `fetchState()` call at the top of the effect will also fire immediately on that transition, so there is a one-off double-fetch at the moment P2 joins. This is harmless (idempotent GET) and the extra latency is negligible.

### 3c. Handle `waiting_for_p2` state in DraftPage

P1 may navigate directly to `/draft/{lobbyId}` before P2 joins (bookmarked URL). Handle this explicitly:

```javascript
if (draft?.status === "waiting_for_p2") {
    return <WaitingForP2Screen joinUrl={`${window.location.origin}/draft/${lobbyId}/join`} />;
}
```

Renders the same join URL + QR code. P1 can re-share from this screen too.

### 3d. Turn-gated buttons

```javascript
const isMyTurn = draft?.whose_turn === localRole && draft?.status === "active";

<button disabled={!isMyTurn} onClick={() => doAction(card.id)}>
    {isMyTurn ? "Pick" : "Waiting for opponent..."}
</button>
```

### 3e. Handle 403 on action submission

```javascript
const res = await draftFetch(lobbyId, "/action", {
    method: "POST",
    body: JSON.stringify({ card_id }),
});
if (res.status === 403) {
    showToast("It's not your turn");
    return;
}
```

### 3f. Undo — only show for the last-acting player

```javascript
const canUndo = draft?.whose_turn !== localRole && draft?.status === "active";
// Show undo button only when canUndo is true
```

---

## Phase 4: AWS Deployment

### EC2 Backend

Run gunicorn with **single worker** — critical, as `lobbies` is in-memory:
```
gunicorn -w 1 -b 127.0.0.1:5050 main:app
```

Put nginx in front on port 443 with Let's Encrypt (required — browsers block mixed HTTP/HTTPS content):

```nginx
server {
    listen 443 ssl;
    # ... cert config ...
    location /api/ {
        proxy_pass http://127.0.0.1:5050;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    return 301 https://$host$request_uri;
}
```

**EC2 Security Group:** Open inbound **80** (HTTP→HTTPS redirect), **443** (HTTPS), and **22** (SSH).

### Amplify Frontend

**Vite proxy** — conditional on dev mode only:
```javascript
// vite.config.js
export default defineConfig(({ mode }) => ({
    // ... other config ...
    server: mode === "development" ? {
        proxy: { "/api": "http://localhost:5050" }
    } : {}
}))
```

**Amplify catch-all rewrite rule (required):** Without this, navigating directly to `/draft/:lobbyId/join` returns a 404.

In Amplify Console → App settings → Rewrites and redirects:
```
Source:  /<*>
Target:  /index.html
Type:    200 (Rewrite)
```

**Environment variable** in Amplify Console → Environment variables:
```
VITE_API_URL = https://api.yourdomain.com
```

---

## Critical Files

| File | Change |
|------|--------|
| `backend/draft.py` | `get_whose_turn()` helper with bounds guards; tokens + status + `_lock` + `created_at` in lobby dict; new `/join` endpoint with lock; lock + token validation in `/action`; fair undo (last-actor token check) in `/undo`; status/whose_turn/p2_joined in `get_state_view`; 404 on missing lobby |
| `main.py` | CORS with `re.compile` regex for Amplify; lobby pruning daemon thread |
| `react-frontend/src/api.js` | **New** — `tokenKey`/`roleKey` helpers; `apiFetch` + `draftFetch` |
| `react-frontend/src/pages/JoinPage.jsx` | **New** — localStorage check; fires join; stores token + role; navigates to draft |
| `react-frontend/src/pages/LandingPage.jsx` | Stores p1_token + role; shows inline waiting screen with join URL + QR code |
| `react-frontend/src/pages/DraftPage.jsx` | Role detection; adaptive polling via `useCallback`; `waiting_for_p2` screen with shareable link; turn-gated buttons; undo shown for last-actor only |
| `react-frontend/src/App.jsx` | Add `/draft/:lobbyId/join` route |
| `react-frontend/vite.config.js` | Dev-mode-conditional proxy |

---

## Verification

1. **Local two-tab test:** Tab 1 creates draft → sees waiting screen with join URL + QR code. Tab 2 opens join URL → joins → Tab 1 navigates to draft automatically. Both complete all 4 bans + 16 picks. Record a winner.

2. **Token enforcement test:** POST `/api/{id}/action` with wrong token → 403. No header → 403. Right token, wrong turn → 403. Right token, right turn → 200.

3. **Undo test:** P1 bans a card. Before P2 bans, P1 should see undo button and be able to undo. P2 should not. After P2 bans, P2 should see undo button, P1 should not.

4. **Double-join test:** Tab 2 double-clicks join URL. localStorage check skips second request. Tab 2 lands on draft successfully.

5. **Expired lobby test:** Manually remove lobby from memory. Refresh DraftPage → redirect to home with "Lobby expired" message.

6. **Deep URL test (Amplify):** Paste `/draft/{lobbyId}/join` directly into browser on Amplify URL → loads `JoinPage`, not 404. Confirms catch-all rewrite is configured.

7. **AWS end-to-end:** Two real devices on different networks complete a full draft via the Amplify URL.
