# Agent Script — Shoot Prototype (throwaway)

A web prototype to test the full on-site loop on your **Android phone today**:
**script → teleprompter record → live captions + hook overlay → preview → save/share.**

This is disposable — it exists to validate the *workflow and feel*, not to be the production
app. Production rendering (burning captions/overlays into the file) is the native Android step;
here the overlays are live previews on top of the video.

## Test it today (≈5 min)
1. Go to <https://app.netlify.com/drop> and drag this `shoot-prototype` folder on.
2. Open the HTTPS URL Netlify gives you **on your Android phone in Chrome** (HTTPS is required for
   the camera).
3. First launch: tap ⚙ and paste your Anthropic API key (Haiku 4.5 is the fast default).
4. **Script:** type an idea → *Generate script*. Edit the hook / say / caption if you want.
5. **Shoot:** *Next: Shoot it →*. Allow camera + mic. Tap the red button to record; the teleprompter
   scrolls (drag the speed slider; tap the teleprompter to pause). The hook shows on-screen; live
   captions appear at the bottom.
6. **Preview:** play it back with the hook + caption overlays synced. Toggle them on/off.
7. **Save/Share:** *Save / Share clip* opens Android's share sheet (or downloads the clip).

## What's real vs. faked (so you know what you're testing)
- **Real:** script generation, teleprompter recording, camera flip, live transcription captions,
  synced preview overlays, save/share.
- **Faked / prototype-only:** overlays are **not burned into** the saved file (that's the native
  Media3 render step). Captions use the browser's live speech API — solid on most Androids, patchy
  on some, and they need a signal. The saved file is your **raw clip**.

## Known prototype limits
- Captions + recording both want the mic; on a few devices the live captions may not populate —
  the video still records fine (graceful degradation).
- Recording format is WebM (Android Chrome default) — perfect for testing, not the final deliverable.
- iOS Safari is **not** a target for this prototype (its PWA video support is weak — that's exactly
  why production goes native).

## Files
- `index.html` — three screens (script / record / preview) + styles
- `app.js` — script brain, camera, teleprompter, recorder, captions, preview sync, share
