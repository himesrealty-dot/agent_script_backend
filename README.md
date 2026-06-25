# Agent Script — Backend (Railway)

A tiny FastAPI service that holds the Anthropic key **server-side** and generates scripts, so the
phone never sees the key. One endpoint. Isolated from your other Railway services on purpose.

## Endpoints
- `GET /` → health check (`{"ok": true, "key_configured": true}`)
- `POST /generate-script` → body `{ "idea": "...", "model": "claude-haiku-4-5" }` → returns
  `{ "hook": "...", "say": "...", "caption": "...", "raw": "..." }`

## Deploy to Railway

### Option A — from a GitHub repo (recommended)
1. Put this `script-backend` folder in a GitHub repo (its own repo, or a subfolder).
2. Railway → **New Project → Deploy from GitHub repo** → pick it. (If it's a subfolder, set
   **Root Directory** to `script-backend` in the service Settings.)
3. Service → **Variables** → add:
   - `ANTHROPIC_API_KEY` = `sk-ant-...`  (required)
   - `APP_SHARED_SECRET` = any random string  (optional — locks the endpoint; the app must send it)
   - `ALLOWED_ORIGINS` = `*`  (fine for the prototype; tighten later to your site origin)
4. Service → **Settings → Networking → Generate Domain**. Copy that URL (e.g.
   `https://agent-script-backend-production.up.railway.app`).
5. Open `https://<your-domain>/` in a browser — you should see `{"ok": true, "key_configured": true}`.

### Option B — no repo, Railway CLI
```bash
npm i -g @railway/cli
railway login
cd script-backend
railway init          # creates a new project
railway up            # deploys this folder
railway variables set ANTHROPIC_API_KEY=sk-ant-...
# then Generate Domain in the dashboard (step 4 above)
```

## Test it
```bash
curl -X POST https://<your-domain>/generate-script \
  -H "content-type: application/json" \
  -H "x-app-secret: <your secret if you set one>" \
  -d '{"idea":"what $400k gets you in Tampa right now"}'
```

## Point the app at it
In the shoot prototype → ⚙ Settings → **Backend URL**, paste your Railway domain (and the
**App secret** if you set `APP_SHARED_SECRET`). Once a Backend URL is set, the app calls Railway and
the on-device Anthropic key is no longer used.

## Run locally (optional)
```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload
# POST to http://localhost:8000/generate-script
```
