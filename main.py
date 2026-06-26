"""
Agent Script — backend (Railway).

Holds the Anthropic API key server-side and exposes one endpoint the phone calls,
so the key never lives on a device. Deliberately small and isolated from any other
service — this is the "brain" for the script app, nothing else.

Env vars (set these in Railway → Variables):
  ANTHROPIC_API_KEY   (required)  your Anthropic key
  APP_SHARED_SECRET   (optional)  if set, callers must send header  x-app-secret: <value>
  ALLOWED_ORIGINS     (optional)  comma-separated origins for CORS; defaults to "*"
"""

import os
import re
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import anthropic

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
APP_SHARED_SECRET = os.environ.get("APP_SHARED_SECRET")  # optional gate
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

# .strip() guards against a trailing newline/space in the env var (a common paste footgun
# that produces "Illegal header value" on every request).
_CLEAN_KEY = (ANTHROPIC_API_KEY or "").strip()
client = anthropic.Anthropic(api_key=_CLEAN_KEY) if _CLEAN_KEY else None

SYSTEM = """You write SHORT, authentic talking-to-camera scripts for real estate agents shooting UGC video on their phone — real and conversational, NOT a polished ad. Like talking to a friend.

Output EXACTLY this labeled format and nothing else:
HOOK: <one scroll-stopping spoken line, under 12 words — also shown as on-screen text>
SAY: <what the agent reads to camera: 55-85 words, short natural spoken sentences, ONE idea, ends with a simple CTA like "comment WORD" or "DM me">
CAPTION: <a 1-2 line post caption with a soft CTA and 3-5 hashtags>

Rules: real estate specific, concrete, hyperlocal when possible. No corporate jargon, no hype, use contractions, sound like a real person."""

app = FastAPI(title="Agent Script Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScriptRequest(BaseModel):
    idea: str
    model: Optional[str] = None


def parse_script(text: str) -> dict:
    def grab(pattern: str) -> str:
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else ""

    hook = grab(r"HOOK:\s*(.*?)(?=\n\s*SAY:|\Z)")
    say = grab(r"SAY:\s*(.*?)(?=\n\s*CAPTION:|\Z)")
    caption = grab(r"CAPTION:\s*(.*)\Z")
    if not say:  # model didn't follow the format — fall back to raw
        return {"hook": "", "say": text.strip(), "caption": ""}
    return {"hook": hook, "say": say, "caption": caption}


@app.get("/health")
def health():
    return {"ok": True, "service": "agent-script-backend", "key_configured": bool(client)}


@app.post("/generate-script")
def generate_script(req: ScriptRequest, x_app_secret: Optional[str] = Header(default=None)):
    if APP_SHARED_SECRET and x_app_secret != APP_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if client is None:
        raise HTTPException(status_code=500, detail="Server is missing ANTHROPIC_API_KEY")
    if not req.idea.strip():
        raise HTTPException(status_code=400, detail="idea is required")

    model = (req.model or "claude-haiku-4-5").strip()
    try:
        msg = client.messages.create(
            model=model,
            max_tokens=600,
            system=SYSTEM,
            messages=[{"role": "user", "content": "Idea: " + req.idea.strip()}],
        )
    except anthropic.APIConnectionError as e:
        cause = getattr(e, "__cause__", None)
        raise HTTPException(status_code=502, detail=f"Connection to Anthropic failed: {repr(cause) if cause else repr(e)}")
    except anthropic.APIStatusError as e:
        detail = getattr(e, "message", None) or str(e)
        raise HTTPException(status_code=getattr(e, "status_code", 502), detail=detail)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream error: {repr(e)}")

    text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
    result = parse_script(text)
    result["raw"] = text
    return result


# Serve the web app (index.html, app.js) from the same origin as the API.
# Mounted LAST so the API routes above take precedence over the catch-all.
_WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
if os.path.isdir(_WEB_DIR):
    app.mount("/", StaticFiles(directory=_WEB_DIR, html=True), name="web")
