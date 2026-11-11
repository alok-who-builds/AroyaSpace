# us & ours. (free edition)

A private two-person scrapbook for the physical cash you save together. Total cost: **₹0**.

| Part | Where | Cost |
|---|---|---|
| Website (`docs/`) | GitHub Pages | free |
| Server (`backend/`) | Render **free** web service | free (sleeps after 15 min idle, wakes in ~1 min) |
| Database | Turso (hosted SQLite) | free plan, no card needed |

Render's free plan has no disk, so the savings live in Turso, not on the server. Restarting or redeploying the server never loses data.

```
backend/  server.js, auth.js, db.js (Turso/local), store.js (all the rules), handlers.js (sockets)
docs/     index.html, css/style.css, js/{config,constants,network,app}.js   (named docs so GitHub Pages can serve it)
```

## How it works
- **Who are you?** Pick Batman or Cinderella, then type your code. The server checks it (codes live only in Render env vars) and returns a signed 90-day session token. No code, no book.
- **One balance, from history.** Balance = sum of the append-only `transactions` table (database triggers refuse UPDATE/DELETE). Mistakes are fixed with a visible correction.
- **Dreams never double count.** Money set aside for a dream is a separate ledger inside the balance. Free money = balance − set aside.
- **Real secrets.** Secret wishes are filtered on the server per person; the other phone never receives them.
- **Sync.** Every action has a client-made id (retries are harmless). After each change both people get a fresh personal snapshot; every reconnect starts with one.

## Deploy (all free)
1. **Turso:** sign up at turso.tech → create a database → copy its URL (`libsql://…turso.io`) and create a token (copy it). Needs no card.
2. **GitHub:** new *public* repo, upload this folder's contents (`backend`, `docs`, …).
3. **Render:** New → Web Service → the repo. Root Directory `backend`, Build `npm install`, Start `node server.js`, Instance type **Free**. Environment variables:
   `NODE_VERSION=22.14.0`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BATMAN_CODE`, `CINDERELLA_CODE` (each ≥ 6 chars, different), `SESSION_SECRET` (long random), `FRONTEND_ORIGIN=https://YOUR-USERNAME.github.io`.
4. Put the Render URL in `docs/js/config.js` and commit.
5. GitHub → Settings → Pages → branch `main`, folder `/docs`.
6. Open `https://YOUR-USERNAME.github.io/REPO/`, pick who you are, enter your code.

**Optional, to avoid the 1-minute wake-up:** add a free pinger (UptimeRobot or cron-job.org) that opens your Render URL every 5–10 minutes. One always-awake service fits inside Render's 750 free hours per month.

## Local testing (no accounts)
```bash
cd backend && cp .env.example .env     # delete the two TURSO lines to use a local file
npm install && npm start               # Node 22.13+
npm test                               # rules test-suite
```
Serve `docs/` with `python3 -m http.server 8080` and set `SERVER_URL` to `http://localhost:3000`.

## Good to know
- Free tiers can change; check Render and Turso pricing pages if something stops working.
- Back up: Turso's free plan keeps 1 day of point-in-time restore. For long-term safety, occasionally export from the Turso dashboard/CLI.
- Changing a code in Render locks out old sessions only after you also change `SESSION_SECRET`.
- `docs/js/constants.js` is a copy of `backend/constants.js`; keep them identical.
