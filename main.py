"""
Clash Royale Draft Tool
=======================
Run with:  python main.py
Then open: http://127.0.0.1:5050

Setup:
  1. Get a free API token at https://developer.clashroyale.com
     (whitelist your current IP address there)
  2. Add CR_API_TOKEN to a .env file in the project root:
       CR_API_TOKEN=your_token_here
  3. python main.py

Draft format:
  Ban phase  — P1 → P2 → P2 → P1   (2 bans each)
  Pick phase — snake draft, 8 picks each (16 total)

Deck string — generates a https://link.clashroyale.com/deck/en?deck=... link
              using the official card IDs returned by the CR API so you can
              tap it on your phone and import the deck directly into the game.
"""

import re
import threading
import time
import webbrowser

from flask import Flask
from flask_cors import CORS

from config import CR_API_TOKEN, PORT
from backend.cards import fetch_cards
from backend.draft import draft_bp, lobbies
import backend.draft as _draft
from backend.stats import stats_bp
from frontend.frontend import frontend_bp

# ── App factory ───────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static")
CORS(app, resources={r"/api/*": {
    "origins": [
        "http://localhost:5173",
        re.compile(r"https://.*\.amplifyapp\.com"),
    ],
    "allow_headers": ["Content-Type", "X-Player-Token"],
}})

app.register_blueprint(draft_bp)
app.register_blueprint(stats_bp)
app.register_blueprint(frontend_bp)


# ── Lobby pruning (remove lobbies older than 6 hours) ─────────────────────────
def _prune_lobbies():
    while True:
        time.sleep(1800)  # every 30 minutes
        cutoff = time.time() - (6 * 3600)
        to_delete = [lid for lid, l in list(lobbies.items())
                     if l.get("created_at", 0) < cutoff]
        for lid in to_delete:
            lobbies.pop(lid, None)

threading.Thread(target=_prune_lobbies, daemon=True).start()


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not CR_API_TOKEN:
        print("\n⚠️  WARNING: CR_API_TOKEN environment variable is not set!")
        print("   Add it to your .env file: CR_API_TOKEN=your_token_here")
        print("   Get one at: https://developer.clashroyale.com\n")

    # Pre-load card data so match history icons work before any draft is started
    if CR_API_TOKEN and not _draft.cards_cache:
        try:
            print("⏳  Pre-loading card data…")
            _draft.cards_cache[:] = fetch_cards()
            print(f"✅  Loaded {len(_draft.cards_cache)} cards.")
        except Exception as e:
            print(f"⚠️  Could not pre-load cards: {e}")

    url = f"http://127.0.0.1:{PORT}"
    print(f"⚔️  CR Draft starting on {url}")
    print("   Press Ctrl+C to stop.\n")

    def open_browser():
        import time
        time.sleep(1.2)
        webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()

    app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False)