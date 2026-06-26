"""
Agent Script Pro — backend (Railway).

Holds the Anthropic API key server-side and runs the "world-class brain": a research-backed
script writer that returns a script PLUS a structured, evidence-anchored quality scorecard,
steerable by goal presets. The web app is served from the same origin (see StaticFiles mount).

Env vars (Railway → Variables):
  ANTHROPIC_API_KEY   (required)  your Anthropic key
  APP_SHARED_SECRET   (optional)  if set, callers must send header  x-app-secret: <value>
  ALLOWED_ORIGINS     (optional)  comma-separated CORS origins; defaults to "*"
"""

import json
import os
import re
from typing import List, Literal, Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
import anthropic

# ----------------------------------------------------------------------------- config
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
APP_SHARED_SECRET = os.environ.get("APP_SHARED_SECRET")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

_CLEAN_KEY = (ANTHROPIC_API_KEY or "").strip()
client = anthropic.Anthropic(api_key=_CLEAN_KEY) if _CLEAN_KEY else None

DEFAULT_MODEL = "claude-sonnet-4-6"
ALLOWED_MODELS = {
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
}


def _supports_thinking(model: str) -> bool:
    # Haiku doesn't support adaptive thinking; everything else here does.
    return "haiku" not in model


# ----------------------------------------------------------------------------- rubric config
# The 10 scored dimensions. Preset "points" are normalized to weights summing to 1.0.
DIMENSIONS = [
    "arousal", "curiosity_gap", "surprise", "identity_resonance", "emotional_cta",
    "hook_strength", "benefit", "specificity", "local_relevance", "voice_match",
]

PRESET_POINTS = {
    "lead_gen": {
        "arousal": 3, "emotional_cta": 4, "identity_resonance": 3, "benefit": 3,
        "curiosity_gap": 2, "hook_strength": 2, "surprise": 1, "specificity": 2,
        "local_relevance": 1, "voice_match": 1,
    },
    "authority": {
        "arousal": 2, "curiosity_gap": 4, "specificity": 4, "benefit": 3,
        "hook_strength": 2, "emotional_cta": 2, "identity_resonance": 2, "surprise": 1,
        "local_relevance": 1, "voice_match": 2,
    },
    "reach": {
        "arousal": 4, "surprise": 4, "hook_strength": 4, "curiosity_gap": 3,
        "emotional_cta": 1, "identity_resonance": 2, "benefit": 1, "specificity": 1,
        "local_relevance": 1, "voice_match": 1,
    },
}


def _preset_weights(preset: str) -> dict:
    pts = PRESET_POINTS.get(preset, PRESET_POINTS["lead_gen"])
    total = sum(pts.values()) or 1
    return {k: round(v / total, 4) for k, v in pts.items()}


# ----------------------------------------------------------------------------- the brain
MASTER_PROMPT = """You are Agent Script Pro — an elite short-form video scriptwriter for real estate. You write authentic talking-to-camera UGC (Reels/TikTok/Shorts), not polished ads. You think in arousal, curiosity, and action — not paragraphs.

CONSTITUTION (never violate)
- Authentic > polished. Talk to ONE person ("you"), use contractions, sound like a real human.
- One video = one idea = one CTA. Cut anything that doesn't serve the single point.
- Spoken, not written: every line must sound natural said aloud.
- COMPLIANCE FLOOR (hard): never invent stats, prices, or rates; flag any claim needing a disclaimer; respect Fair Housing (never steer or describe people/areas by protected class); any surprising claim must be TRUE, never misleading.

WHAT MAKES A VIDEO WORK — 3 PILLARS
1) STOP THE SCROLL (first ~2s): a pattern interrupt delivered as visual + spoken line + on-screen text; the hook's promise lands in the first line; works on mute.
2) KEEP ATTENTION: open a curiosity loop early, pay it off LATE; no spoken stretch >~8s without a visual change; a re-hook near the midpoint; every beat advances the one idea.
3) GET THEM TO ACT: ONE low-pressure CTA toward a HIGH-VALUE action (comment a keyword / DM / save / share — not "follow/link in bio"); tease it early, restate near the payoff; deliver value before the ask.

THE EMOTIONAL CORE — AROUSAL IS THE MASTER METRIC
Sharing and action are driven by emotional AROUSAL (activation), not by positive vs negative.
- HIGH-arousal (good): awe, excitement, amusement, anger/indignation, anxiety/fear, surprise, FOMO, aspiration, relief.
- LOW-arousal (the script FAILS if this is the dominant feeling): sadness, calm, "informative but flat", neutral.
Routes to arousal you deliberately engineer: curiosity gap, expectation violation (a TRUE counter-intuitive thing), identity resonance ("this is about ME"), and an emotional CTA that pays off the feeling you raised (relief / belonging / identity / aspiration).

PROCESS (do this reasoning, then output ONLY the JSON object)
1. Generate 5 distinct hooks across families (contrarian, number, mistake, hyperlocal callout, curiosity/value-reveal). Score each on arousal + curiosity + mute-clarity. Keep the winner + 2 alternates.
2. Draft the script on the spine: hook (0-3s, layered) -> open loop/stakes -> 2-3 fast value beats -> mid re-hook -> payoff (close the loop) -> emotional CTA.
3. Self-score against the rubric with EVIDENCE. Revise the weakest dimension until every floor passes and the weighted total clears 8/10.
4. Run a viewer simulation: role-play the target (e.g., a skeptical first-time buyer scrolling at night) and note when they'd swipe and why.

OUTPUT — fill the structured schema:
- hook: the winning spoken hook line (also shown as on-screen text). alt_hooks: the 2 runner-up hooks.
- say: the FULL spoken script the agent reads to camera, start to finish (the hook line, the body, and the CTA, as one natural spoken block — this is the teleprompter text). 55-110 words.
- segments: the same script broken into ordered beats: {role:"hook"|"body"|"cta", text}.
- cta: just the call-to-action line. caption: a scroll-stopping post caption with a soft CTA. hashtags: 5-8 (broad + local + niche).
- compliance_flags: list any claim needing a disclaimer or any risk; severity "warn" or "block"; [] if clean.
- scorecard:
  * floors: pass/fail for one_idea, one_cta, hook_lands_fast, sounds_spoken, compliance (each {name, passed, note}).
  * dimensions: score EACH provided dimension 0-10. For each you MUST give EVIDENCE first: emotion = the specific emotion it evokes as a 1-3 WORD label (e.g. anxiety, relief, curiosity, awe) — NOT a sentence; trigger_line = the EXACT quoted line from the script that triggers it; diagnostics = 2-3 yes/no checks specific to that dimension. Use the weight provided for each dimension.
  * weighted_total: sum(weight*score) across dimensions (0-10 scale).
  * viewer_sim: one or two sentences — the target's reaction and the moment they'd swipe, or why they watch to the CTA.

Rules for honest scoring: if the dominant emotion is LOW-arousal, arousal scores <=3 and you must revise. Quote REAL lines from your script as trigger_line — never fabricate evidence. Be a tough grader.

RESPONSE FORMAT — after your reasoning, output ONLY a single JSON object (no prose, no markdown fences) with EXACTLY these keys:
{
  "hook": "the winning spoken hook line",
  "alt_hooks": ["runner-up hook 1", "runner-up hook 2"],
  "say": "the FULL spoken script the agent reads start to finish (hook + body + CTA, one natural block)",
  "cta": "just the call-to-action line",
  "segments": [{"role": "hook", "text": "..."}, {"role": "body", "text": "..."}, {"role": "cta", "text": "..."}],
  "caption": "post caption with a soft CTA",
  "hashtags": ["#one", "#two"],
  "compliance_flags": [{"code": "string", "severity": "warn|block", "note": "string"}],
  "scorecard": {
    "floors": [{"name": "one_idea", "passed": true, "note": "..."}, {"name": "one_cta", "passed": true, "note": "..."}, {"name": "hook_lands_fast", "passed": true, "note": "..."}, {"name": "sounds_spoken", "passed": true, "note": "..."}, {"name": "compliance", "passed": true, "note": "..."}],
    "dimensions": [{"name": "<dimension name>", "weight": 0.0, "score": 0, "evidence": {"emotion": "anxiety", "trigger_line": "\\"quoted line from the script\\"", "diagnostics": [{"q": "...", "answer": true}]}}],
    "weighted_total": 0.0,
    "viewer_sim": "the target's reaction and when they'd swipe"
  }
}
Include one dimensions entry for EACH dimension and weight given in the user message. compliance_flags is [] when clean."""


# ----------------------------------------------------------------------------- output schema
class Diagnostic(BaseModel):
    q: str
    answer: bool


class Evidence(BaseModel):
    emotion: str = ""
    trigger_line: str = ""
    diagnostics: List[Diagnostic] = Field(default_factory=list)


class Dimension(BaseModel):
    name: str
    weight: float = 0.0
    score: int = 0
    evidence: Evidence = Field(default_factory=Evidence)

    @field_validator("score")
    @classmethod
    def _clamp_score(cls, v: int) -> int:
        return max(0, min(10, int(v)))


class Floor(BaseModel):
    name: str
    passed: bool = True
    note: str = ""


class ComplianceFlag(BaseModel):
    code: str = ""
    severity: str = "warn"
    note: str = ""


class Scorecard(BaseModel):
    floors: List[Floor] = Field(default_factory=list)
    dimensions: List[Dimension] = Field(default_factory=list)
    weighted_total: float = 0.0
    viewer_sim: str = ""

    @model_validator(mode="after")
    def _recompute_total(self):
        if self.dimensions:
            total = sum(d.weight * d.score for d in self.dimensions)
            self.weighted_total = round(total, 1)
        return self


class Segment(BaseModel):
    role: str
    text: str


class ScriptOutput(BaseModel):
    hook: str = ""
    alt_hooks: List[str] = Field(default_factory=list)
    segments: List[Segment] = Field(default_factory=list)
    say: str = ""
    cta: str = ""
    caption: str = ""
    hashtags: List[str] = Field(default_factory=list)
    compliance_flags: List[ComplianceFlag] = Field(default_factory=list)
    scorecard: Scorecard = Field(default_factory=Scorecard)


# ----------------------------------------------------------------------------- app
app = FastAPI(title="Agent Script Pro Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_secret(x_app_secret: Optional[str]):
    if APP_SHARED_SECRET and x_app_secret != APP_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _resolve_model(model: Optional[str]) -> str:
    m = (model or DEFAULT_MODEL).strip()
    if m not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {m}")
    return m


def _extract_json(text: str) -> str:
    """Pull the JSON object out of the model's text (tolerate fences / stray prose)."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t).strip()
    start, end = t.find("{"), t.rfind("}")
    if start != -1 and end != -1 and end > start:
        t = t[start:end + 1]
    return t


def _call_structured(*, model: str, user_content: str, max_tokens: int, effort: str = "medium") -> "ScriptOutput":
    if client is None:
        raise HTTPException(status_code=500, detail="Server is missing ANTHROPIC_API_KEY")
    system_blocks = [{
        "type": "text",
        "text": MASTER_PROMPT,
        "cache_control": {"type": "ephemeral"},  # cache the big static prompt
    }]
    kwargs = dict(
        model=model,
        max_tokens=max_tokens,
        system=system_blocks,
        messages=[{"role": "user", "content": user_content}],
    )
    if _supports_thinking(model):
        kwargs["thinking"] = {"type": "adaptive"}
        kwargs["output_config"] = {"effort": effort}  # bound thinking so the JSON isn't truncated
    try:
        resp = client.messages.create(**kwargs)
    except anthropic.APIConnectionError as e:
        cause = getattr(e, "__cause__", None)
        raise HTTPException(status_code=502, detail=f"Connection to Anthropic failed: {repr(cause) if cause else repr(e)}")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=getattr(e, "status_code", 502), detail=getattr(e, "message", None) or str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream error: {repr(e)}")

    if getattr(resp, "stop_reason", None) == "refusal":
        raise HTTPException(status_code=502, detail="Model refused to respond")

    text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")
    if not text.strip():
        raise HTTPException(status_code=502, detail=f"Empty model output (stop={getattr(resp,'stop_reason',None)}); please retry")
    try:
        data = json.loads(_extract_json(text))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Model returned non-JSON ({e}); please retry")
    try:
        parsed = ScriptOutput.model_validate(data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Output failed validation ({e}); please retry")

    # usage logging (no script content)
    try:
        u = resp.usage
        print(f"[generate] model={model} req={getattr(resp,'_request_id',None)} "
              f"in={getattr(u,'input_tokens',None)} out={getattr(u,'output_tokens',None)} "
              f"cache_read={getattr(u,'cache_read_input_tokens',None)} "
              f"cache_write={getattr(u,'cache_creation_input_tokens',None)}", flush=True)
    except Exception:
        pass
    return parsed


# ----------------------------------------------------------------------------- request models
class ScriptRequest(BaseModel):
    idea: str
    preset: Literal["lead_gen", "authority", "reach"] = "lead_gen"
    mode: Literal["fast", "quality"] = "quality"
    model: Optional[str] = None
    voice_brief: Optional[str] = None  # reserved for Stage C


# ----------------------------------------------------------------------------- routes
@app.get("/health")
def health():
    return {"ok": True, "service": "agent-script-pro-backend", "key_configured": bool(client)}


@app.post("/generate-script")
def generate_script(req: ScriptRequest, x_app_secret: Optional[str] = Header(default=None)):
    _check_secret(x_app_secret)
    if not req.idea.strip():
        raise HTTPException(status_code=400, detail="idea is required")

    model = _resolve_model(req.model)
    weights = _preset_weights(req.preset)
    weights_block = "\n".join(f"- {d}: {weights[d]}" for d in DIMENSIONS)

    user_content = (
        f"GOAL PRESET: {req.preset}\n"
        f"Score these dimensions, using EXACTLY these weights in the scorecard:\n{weights_block}\n\n"
    )
    if req.voice_brief and req.voice_brief.strip():
        user_content += f"VOICE BRIEF (match this; grade voice_match against it):\n{req.voice_brief.strip()}\n\n"
    user_content += f"IDEA / TOPIC:\n{req.idea.strip()}"

    effort = "low" if req.mode == "fast" else "medium"
    parsed: ScriptOutput = _call_structured(model=model, user_content=user_content, max_tokens=12000, effort=effort)

    result = parsed.model_dump()
    result["schema_version"] = 1
    result["preset"] = req.preset
    result["raw"] = parsed.model_dump_json()
    return result


# Serve the web app from the same origin (mounted LAST so API routes take precedence).
_WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
if os.path.isdir(_WEB_DIR):
    app.mount("/", StaticFiles(directory=_WEB_DIR, html=True), name="web")
