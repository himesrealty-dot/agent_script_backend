/* Agent Script — Shoot Prototype (throwaway, web). Validates the loop:
   script → teleprompter record → live captions + hook overlay → preview → save. */

const $ = (id)=>document.getElementById(id);
const LS = { key:'asp_key', model:'asp_model', backend:'asp_backend', secret:'asp_secret', preset:'asp_preset', mode:'asp_mode' };
const DEFAULT_MODEL = 'claude-sonnet-4-6';
let currentScript = null;   // full backend response (script + scorecard), stashed for later
const load = (k,d)=>{ try{ const v=localStorage.getItem(k); return v==null?d:v; }catch{ return d; } };
const save = (k,v)=>{ try{ localStorage.setItem(k,v); }catch{} };

/* ---------- Script brain (UGC / teleprompter) ---------- */
const SCRIPT_SYSTEM = `You write SHORT, authentic talking-to-camera scripts for real estate agents shooting UGC video on their phone — real and conversational, NOT a polished ad. Like talking to a friend.

Output EXACTLY this labeled format and nothing else:
HOOK: <one scroll-stopping spoken line, under 12 words — also shown as on-screen text>
SAY: <what the agent reads to camera: 55-85 words, short natural spoken sentences, ONE idea, ends with a simple CTA like "comment WORD" or "DM me">
CAPTION: <a 1-2 line post caption with a soft CTA and 3-5 hashtags>

Rules: real estate specific, concrete, hyperlocal when possible. No corporate jargon, no hype, use contractions, sound like a real person.`;

function parseScript(t){
  const grab = (re)=>{ const m=t.match(re); return m? m[1].trim() : ''; };
  const hook = grab(/HOOK:\s*([\s\S]*?)(?=\n\s*SAY:|$)/i);
  const say  = grab(/SAY:\s*([\s\S]*?)(?=\n\s*CAPTION:|$)/i);
  const caption = grab(/CAPTION:\s*([\s\S]*)$/i);
  if(!say) return { hook:'', say:t.trim(), caption:'' };   // fallback: dump raw into teleprompter
  return { hook, say, caption };
}

function servedFromHost(){ return location.protocol==='http:' || location.protocol==='https:'; }

// Returns { hook, say, caption }.
// Priority: explicit Backend URL → on-device key (direct) → same-origin backend
// (when served by Railway, '/generate-script' is local, so no setup is needed).
async function generateScript(idea, preset, mode){
  const model = load(LS.model, DEFAULT_MODEL);
  const explicitBackend = (load(LS.backend,'')||'').trim().replace(/\/+$/,'');
  const key = (load(LS.key,'')||'').trim();

  let backend = null;
  if(explicitBackend) backend = explicitBackend;
  else if(key) backend = null;            // use the direct-Anthropic path below
  else if(servedFromHost()) backend = ''; // same-origin relative call

  if(backend !== null){
    const headers = { 'content-type':'application/json' };
    const secret = (load(LS.secret,'')||'').trim();
    if(secret) headers['x-app-secret'] = secret;
    const res = await fetch(backend + '/generate-script', {
      method:'POST', headers, body: JSON.stringify({ idea, model, preset, mode }),
    });
    if(!res.ok){
      let d=''; try{ const j=await res.json(); d=j.detail || JSON.stringify(j); }catch{ d=await res.text(); }
      if(res.status===401) throw new Error('Backend rejected the request (app secret mismatch?).');
      throw new Error(`Backend error ${res.status}: ${d}`);
    }
    return await res.json();   // full object: hook/say/caption + scorecard + compliance + alt_hooks
  }

  // Direct-to-Anthropic fallback (BYO key on device — only when not served by a backend)
  if(!key) throw new Error('NO_AUTH');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-api-key': key,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
    },
    body: JSON.stringify({
      model, max_tokens: 600, system: SCRIPT_SYSTEM,
      messages: [{ role:'user', content: 'Idea: ' + idea }],
    }),
  });
  if(!res.ok){
    let d=''; try{ const j=await res.json(); d=j.error?.message||JSON.stringify(j);}catch{ d=await res.text(); }
    if(res.status===401) throw new Error('Invalid API key — check Settings.');
    throw new Error(`API error ${res.status}: ${d}`);
  }
  const j = await res.json();
  const raw = (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  return parseScript(raw);
}

/* ---------- Screen routing ---------- */
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ---------- SCREEN 1: script ---------- */
const SEEDS = [
  'What $400k gets you in [your city] right now',
  '3 mistakes first-time buyers make at closing',
  'Myth: wait for rates to drop before buying',
  'Why this neighborhood is heating up',
];
(function(){
  const wrap = $('seeds');
  SEEDS.forEach(s=>{
    const b=document.createElement('button'); b.className='seed'; b.textContent=s;
    b.onclick=()=>{ $('idea').value=s; };
    wrap.appendChild(b);
  });
})();

// Auth is satisfied by: an explicit Backend URL, an on-device key, OR simply being
// served from a host (same-origin backend is then assumed — the Railway case).
function hasAuth(){
  return !!((load(LS.backend,'')||'').trim() || (load(LS.key,'')||'').trim() || servedFromHost());
}

/* ---------- Goal presets ---------- */
const PRESET_HINTS = {
  lead_gen: 'Weights the script toward your CTA + identity.',
  authority: 'Weights toward curiosity + specificity + value.',
  reach: 'Weights toward arousal + surprise + a strong hook.',
};
let currentPreset = load(LS.preset, 'lead_gen');
function syncPresetUI(){
  document.querySelectorAll('#presetRow .preset').forEach(b=>{
    b.classList.toggle('sel', b.dataset.preset===currentPreset);
  });
  const h=$('presetHint'); if(h) h.textContent = PRESET_HINTS[currentPreset] || '';
}
$('presetRow').addEventListener('click', (e)=>{
  const b=e.target.closest('.preset'); if(!b) return;
  currentPreset = b.dataset.preset; save(LS.preset, currentPreset); syncPresetUI();
});

/* ---------- Fast / Quality mode ---------- */
let currentMode = load(LS.mode, 'quality');
function syncModeUI(){
  document.querySelectorAll('#modeRow .modeBtn').forEach(b=>b.classList.toggle('sel', b.dataset.mode===currentMode));
}
$('modeRow').addEventListener('click', (e)=>{
  const b=e.target.closest('.modeBtn'); if(!b) return;
  currentMode = b.dataset.mode; save(LS.mode, currentMode); syncModeUI();
});

/* ---------- Progress feedback during the (~1 min) generation ---------- */
let progressTimer=null;
function startProgress(mode){
  const steps = mode==='fast'
    ? [[0,'✍️ Writing hooks…'],[6,'🧠 Scoring…'],[14,'✨ Polishing…']]
    : [[0,'✍️ Writing 5 hooks…'],[10,'🎯 Picking the strongest…'],[24,'🧠 Scoring against the rubric…'],[40,'⚖️ Checking compliance…'],[55,'✨ Polishing the script…']];
  const el=$('genStatus'); const t0=Date.now();
  const tick=()=>{
    const s=Math.floor((Date.now()-t0)/1000);
    let msg=steps[0][1]; for(const [thr,m] of steps){ if(s>=thr) msg=m; }
    el.textContent = `${msg}  ·  ${s}s`;
  };
  tick(); progressTimer=setInterval(tick, 1000);
}
function stopProgress(){ if(progressTimer){ clearInterval(progressTimer); progressTimer=null; } $('genStatus').textContent=''; }

$('genBtn').onclick = async ()=>{
  const idea = $('idea').value.trim();
  const err = $('genErr'); err.textContent='';
  if(!hasAuth()){ openSettings('Add your Railway Backend URL (or an Anthropic key) first.'); return; }
  if(!idea){ err.textContent='Type an idea (or tap a suggestion).'; return; }
  const btn=$('genBtn'); btn.disabled=true; const old=btn.textContent; btn.textContent='Writing…';
  startProgress(currentMode);
  try{
    const p = await generateScript(idea, currentPreset, currentMode);
    currentScript = p;
    $('hook').value = p.hook || '';
    $('say').value = p.say || '';
    $('caption').value = p.caption || '';
    $('scriptCard').style.display='block';
    renderAltHooks(p.alt_hooks);
    renderScorecard(p);
    $('scriptCard').scrollIntoView({behavior:'smooth'});
  }catch(e){
    if((e.message||'')==='NO_AUTH'){ openSettings('Add your Railway Backend URL (or an Anthropic key) first.'); }
    else err.textContent = e.message || String(e);
  }
  finally{ stopProgress(); btn.disabled=false; btn.textContent=old; }
};

/* ---------- Scorecard rendering ---------- */
function renderAltHooks(alts){
  const el=$('altHooks'); if(!el) return;
  if(Array.isArray(alts) && alts.length){
    el.innerHTML = '<b>Alt hooks:</b> ' + alts.map(h=>esc(h)).join(' &nbsp;·&nbsp; ');
  } else { el.innerHTML=''; }
}
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderScorecard(p){
  const card=$('scoreCard');
  const sc = p && p.scorecard;
  if(!sc || !(sc.dimensions||[]).length){ card.style.display='none'; return; }
  card.style.display='block';

  $('scoreNum').innerHTML = (sc.weighted_total!=null ? Number(sc.weighted_total).toFixed(1) : '—') + '<small>/10</small>';

  // floors
  $('floorsRow').innerHTML = (sc.floors||[]).map(f=>
    `<span class="floorChip ${f.passed?'pass':'fail'}">${f.passed?'✓':'✗'} ${esc(f.name)}</span>`
  ).join('');

  // dimensions (sorted by weight desc)
  const dims = (sc.dimensions||[]).slice().sort((a,b)=>(b.weight||0)-(a.weight||0));
  $('dimsList').innerHTML = dims.map(d=>{
    const ev = d.evidence||{};
    const diags = (ev.diagnostics||[]).map(x=>`${x.answer?'✓':'✗'} ${esc(x.q)}`).join(' &nbsp; ');
    return `<div class="dim">
      <div class="dimTop"><span class="nm">${esc(d.name).replace(/_/g,' ')}</span>
        <span class="wt">w ${(d.weight!=null?Number(d.weight).toFixed(2):'')}</span>
        <span class="sc">${d.score}/10</span></div>
      <div class="dimBarTrack"><div class="dimBarFill" style="width:${(d.score||0)*10}%"></div></div>
      <div class="ev">${ev.emotion?`<span class="chip">${esc(ev.emotion)}</span>`:''}${ev.trigger_line?`<span class="quote">${esc(ev.trigger_line)}</span>`:''}${diags?`<div style="margin-top:3px">${diags}</div>`:''}</div>
    </div>`;
  }).join('');

  // compliance
  const cb=$('complianceBox');
  const flags=(p.compliance_flags||[]);
  if(flags.length){ cb.style.display='block';
    cb.innerHTML = '<b>⚠ Compliance:</b> ' + flags.map(f=>`${esc(f.severity)} — ${esc(f.note)}`).join('<br>');
  } else { cb.style.display='none'; }

  $('viewerSim').textContent = sc.viewer_sim ? ('🧪 ' + sc.viewer_sim) : '';
}

$('toRecord').onclick = ()=>{
  // push current script into the record stage
  const hook = $('hook').value.trim();
  buildTeleWords($('say').value.trim() || '(no script — you can still record)');
  const ho = $('hookOverlay').querySelector('span');
  ho.textContent = hook;
  $('hookOverlay').style.display = hook ? 'block' : 'none';
  takes=[]; chosenIdx=-1; updateTakesBtn();
  teleResetPos(); teleRun=false; setPauseUI();
  show('s2');
  startCamera();
};

/* ---------- SCREEN 2: camera + teleprompter + record ---------- */
let stream=null, recorder=null, chunks=[], facing='environment';
let recording=false, recStart=0, recTimer=null;
let captions=[];            // [{t:secondsSinceStart, text}] for the current take
let recog=null, capOn=true, interimText='';
let takes=[];               // each: {blob, url, captions:[], dur}
let chosenIdx=-1, previewCaptions=[];

let zoom = 1, camRAF = null;

async function startCamera(){
  try{
    if(stream){ stream.getTracks().forEach(t=>t.stop()); }
    stream = await navigator.mediaDevices.getUserMedia({
      // request a vertical stream; the canvas guarantees true 9:16 regardless
      video:{ facingMode: facing, width:{ideal:1080}, height:{ideal:1920}, aspectRatio:{ideal:9/16} },
      audio:true,
    });
    const cam = $('cam');
    cam.srcObject = stream;
    await cam.play().catch(()=>{});
    startCanvasDraw();
  }catch(e){
    alert('Camera/mic blocked or unavailable.\n\nOpen this over HTTPS and allow camera + microphone.\n\n'+(e.message||e));
    show('s1');
  }
}

// Draw the camera onto a 9:16 canvas (true vertical) with cover-fit + zoom.
// zoom 1.0 = fill the frame; <1 zooms out (letterbox); >1 zooms in (crop).
function startCanvasDraw(){
  const cam = $('cam'), cv = $('canvasCam'), ctx = cv.getContext('2d');
  if(camRAF) cancelAnimationFrame(camRAF);
  const loop = ()=>{
    const vw = cam.videoWidth, vh = cam.videoHeight;
    if(vw && vh){
      const cw = cv.width, ch = cv.height;
      const scale = Math.max(cw/vw, ch/vh) * zoom;   // cover-fit × zoom
      const dw = vw*scale, dh = vh*scale;
      const dx = (cw-dw)/2, dy = (ch-dh)/2;
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,cw,ch);
      ctx.save();
      if(facing === 'user'){ ctx.translate(cw,0); ctx.scale(-1,1); }  // mirror selfie
      ctx.drawImage(cam, dx, dy, dw, dh);
      ctx.restore();
    }
    camRAF = requestAnimationFrame(loop);
  };
  loop();
}

$('flipCam').onclick = ()=>{ facing = (facing==='environment')?'user':'environment'; startCamera(); };
$('backToScript').onclick = ()=>{ stopCamera(); show('s1'); };
function stopCamera(){
  if(camRAF){ cancelAnimationFrame(camRAF); camRAF=null; }
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
}
$('zoom').addEventListener('input', ()=>{ zoom = (parseInt($('zoom').value,10)||100)/100; });

/* teleprompter: auto-scroll + drag-to-rewind + pause */
let teleY=0, teleRAF=null, teleLast=0, teleRun=false;
let dragging=false, dragStartY=0, dragStartTeleY=0;
let voiceMode=false, teleTargetY=0;
let scriptWords=[], wordSpans=[], posIdx=0;
function teleClamp(){
  const inner=$('teleInner'), tele=$('tele');
  const top = tele.offsetHeight*0.55;
  const maxScroll = Math.max(0, inner.offsetHeight - tele.offsetHeight*0.2);
  if(teleY > top) teleY = top;
  if(-teleY > maxScroll) teleY = -maxScroll;
}
function teleApply(){ $('teleInner').style.transform = `translateY(${teleY}px)`; }
function teleLoop(ts){
  if(dragging){ teleLast=ts; teleRAF=requestAnimationFrame(teleLoop); return; }
  if(voiceMode){
    teleY += (teleTargetY - teleY) * 0.18;        // ease toward the word being spoken
    teleClamp(); teleApply();
  } else if(teleRun){
    if(!teleLast) teleLast=ts;
    const dt=(ts-teleLast)/1000; teleLast=ts;
    const speed = parseInt($('speed').value,10);  // 0..100
    teleY -= dt * speed * 1.6;                     // px/sec
    teleClamp(); teleApply();
  } else { teleLast=ts; }
  teleRAF=requestAnimationFrame(teleLoop);
}
function teleResetPos(){ teleY = $('tele').offsetHeight*0.5; teleApply(); }
function setPauseUI(){ const b=$('telePause'); if(b) b.textContent = teleRun ? '⏸' : '▶'; }
$('teleReset').onclick = ()=>{ teleResetPos(); };
$('telePause').onclick = ()=>{ teleRun = !teleRun; teleLast=0; setPauseUI(); };

/* drag the script up/down to scrub back to a line you flubbed */
(function(){
  const teleEl=$('tele');
  teleEl.addEventListener('pointerdown',(e)=>{
    dragging=true; dragStartY=e.clientY; dragStartTeleY=teleY;
    try{ teleEl.setPointerCapture(e.pointerId); }catch{}
    const h=$('teleHint'); if(h) h.style.opacity='0';
  });
  teleEl.addEventListener('pointermove',(e)=>{
    if(!dragging) return;
    teleY = dragStartTeleY + (e.clientY - dragStartY);
    teleClamp(); teleApply();
  });
  const end=()=>{ dragging=false; teleLast=0; };
  teleEl.addEventListener('pointerup', end);
  teleEl.addEventListener('pointercancel', end);
  teleEl.addEventListener('pointerleave', end);
})();

/* ---------- Voice-follow teleprompter ---------- */
function normWord(w){ return (w||'').toLowerCase().replace(/[^a-z0-9']/g,''); }
function buildTeleWords(text){
  const inner=$('teleInner'); inner.innerHTML='';
  const p=document.createElement('p'); p.id='teleText';
  scriptWords=[]; wordSpans=[]; posIdx=0;
  (text||'').split(/\s+/).filter(Boolean).forEach(tok=>{
    const span=document.createElement('span'); span.className='w'; span.textContent=tok;
    p.appendChild(span); p.appendChild(document.createTextNode(' '));
    wordSpans.push(span); scriptWords.push(normWord(tok));
  });
  inner.appendChild(p);
}
function setPos(idx){
  posIdx=idx;
  for(let i=0;i<wordSpans.length;i++){
    const s=wordSpans[i];
    s.classList.toggle('done', i<idx);
    s.classList.toggle('cur', i===idx);
  }
  const span=wordSpans[idx]; if(!span) return;
  const readingLineY = $('tele').offsetHeight*0.35;   // keep the current line in the upper-middle
  teleTargetY = readingLineY - span.offsetTop - span.offsetHeight/2;
}
// Match the freshest spoken word to a script word near the current position, and advance.
function advanceFromSpeech(recText){
  if(!scriptWords.length) return;
  const heard = (recText||'').toLowerCase().replace(/[^a-z0-9'\s]/g,' ').split(/\s+/).filter(Boolean);
  if(!heard.length) return;
  let anchor='';
  for(let k=heard.length-1; k>=0 && k>=heard.length-3; k--){ if(heard[k].length>=2){ anchor=heard[k]; break; } }
  if(!anchor) anchor=heard[heard.length-1];
  const start=Math.max(0,posIdx-2), endI=Math.min(scriptWords.length-1,posIdx+16);
  for(let i=start;i<=endI;i++){
    const sw=scriptWords[i]; if(!sw) continue;
    const hit = sw===anchor || (anchor.length>=4 && sw.startsWith(anchor.slice(0,4)));
    if(hit && i>=posIdx-1){ setPos(i); return; }
  }
}
$('voiceToggle').onclick=()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!voiceMode && !SR){ alert('Voice-follow needs speech recognition — use Chrome on Android.'); return; }
  voiceMode=!voiceMode;
  $('voiceToggle').textContent='🎤 Voice: '+(voiceMode?'on':'off');
  $('voiceToggle').classList.toggle('active', voiceMode);
  const hint=$('teleHint'); if(hint) hint.textContent = voiceMode
    ? 'voice-paced — just talk · drag to nudge'
    : 'drag script ↕ to rewind · ⏸ to pause';
  if(voiceMode){ teleTargetY=teleY; if(wordSpans.length) setPos(Math.max(0,posIdx)); }
  else { wordSpans.forEach(s=>s.classList.remove('cur','done')); }
};

/* live captions via Web Speech (best effort, degrades gracefully) */
$('capToggle').onclick = ()=>{
  capOn = !capOn;
  $('capToggle').style.opacity = capOn ? '1':'.4';
  if(!capOn){ $('liveCap').style.display='none'; stopRecog(); }
};
function startRecog(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR || (!capOn && !voiceMode)){ return; }   // run for captions OR voice-follow
  try{
    recog = new SR();
    recog.lang='en-US'; recog.continuous=true; recog.interimResults=true;
    recog.onresult = (ev)=>{
      let interim='';
      for(let i=ev.resultIndex;i<ev.results.length;i++){
        const r=ev.results[i];
        if(r.isFinal){
          const txt=r[0].transcript.trim();
          if(txt) captions.push({ t:(performance.now()-recStart)/1000, text:txt });
        } else { interim += r[0].transcript; }
      }
      interimText = interim.trim();
      if(voiceMode){
        const src = interimText || (captions.length? captions[captions.length-1].text : '');
        if(src) advanceFromSpeech(src);
      }
      const live = interimText || (captions.length? captions[captions.length-1].text : '');
      if(live && capOn){ $('liveCap').style.display='block'; $('liveCapText').textContent = live; }
    };
    recog.onerror = ()=>{
      if(voiceMode){ const h=$('teleHint'); if(h) h.textContent='🎤 voice not picking up here — drag to scroll'; }
    };
    recog.onend = ()=>{ if(recording && capOn){ try{ recog.start(); }catch{} } };
    recog.start();
  }catch{ /* unsupported */ }
}
function stopRecog(){ if(recog){ try{ recog.stop(); }catch{} recog=null; } }

/* recording */
function pickMime(){
  const c=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
  for(const m of c){ if(window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; }
  return '';
}
$('recBtn').onclick = ()=>{ recording ? stopRec() : startRec(); };

function startRec(){
  if(!stream) return;
  chunks=[]; captions=[]; interimText='';
  posIdx=0; if(voiceMode && wordSpans.length) setPos(0);
  const mime=pickMime();
  // Record the 9:16 canvas (true vertical + zoom) plus the mic audio track.
  let recStream;
  try{
    recStream = $('canvasCam').captureStream(30);
    const at = stream.getAudioTracks()[0];
    if(at) recStream.addTrack(at);
  }catch(e){ recStream = stream; }   // fallback to raw stream if captureStream unsupported
  try{ recorder = mime? new MediaRecorder(recStream,{mimeType:mime}) : new MediaRecorder(recStream); }
  catch(e){ alert('Recording not supported on this browser: '+(e.message||e)); return; }
  recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = onRecStop;
  recorder.start();
  recording=true; recStart=performance.now();
  $('recBtn').classList.add('recording');
  $('recTime').classList.add('on');
  teleRun=true; setPauseUI();            // start teleprompter scroll
  startRecog();
  recTimer=setInterval(()=>{
    const s=Math.floor((performance.now()-recStart)/1000);
    $('recElapsed').textContent = Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
  },250);
}
function stopRec(){
  recording=false; teleRun=false; setPauseUI();
  clearInterval(recTimer);
  $('recBtn').classList.remove('recording');
  $('recTime').classList.remove('on');
  stopRecog();
  try{ recorder.stop(); }catch{}
}

function onRecStop(){
  const type = (chunks[0] && chunks[0].type) || 'video/webm';
  const blob = new Blob(chunks, {type});
  const url = URL.createObjectURL(blob);
  const dur = Math.max(0, (performance.now()-recStart)/1000);
  takes.push({ blob, url, captions: captions.slice(), dur });
  updateTakesBtn();
  flashTakeSaved(takes.length);
  teleResetPos(); teleRun=false; setPauseUI();   // ready for the next take
}
function updateTakesBtn(){
  const b=$('reviewTakes'); if(!b) return;
  if(takes.length){ b.style.display='inline-block'; b.textContent=`Takes (${takes.length}) →`; }
  else b.style.display='none';
}
function flashTakeSaved(n){
  const t=document.createElement('div');
  t.textContent=`Take ${n} saved ✓`;
  t.style.cssText='position:absolute;top:14px;left:50%;transform:translateX(-50%);background:rgba(40,160,90,.92);color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:999px;z-index:8';
  $('stage').appendChild(t);
  setTimeout(()=>{ try{ t.remove(); }catch{} }, 1400);
}

/* ---------- SCREEN 2b: choose a take ---------- */
function renderTakes(){
  const list=$('takesList'); list.innerHTML='';
  takes.forEach((tk,i)=>{
    const card=document.createElement('div');
    card.className='takeCard'+(i===chosenIdx?' sel':'');
    const dur = tk.dur ? tk.dur.toFixed(1)+'s' : '';
    const capCount = (tk.captions && tk.captions.length) ? ` · ${tk.captions.length} caption lines` : ' · no captions';
    card.innerHTML =
      `<video src="${tk.url}" playsinline controls preload="metadata"></video>
       <div class="takeMeta">
         <span class="ttl">Take ${i+1}</span><span class="dur">${dur}${capCount}</span>
         <span class="spacer"></span>
         <button class="delBtn" data-del="${i}">Delete</button>
         <button class="selBtn" data-sel="${i}">${i===chosenIdx?'Selected':'Select'}</button>
       </div>`;
    list.appendChild(card);
  });
  $('useTake').disabled = (chosenIdx<0);
}
$('reviewTakes').onclick = ()=>{ if(takes.length){ renderTakes(); show('s2b'); } };
$('takesBack').onclick = ()=>{ show('s2'); };
$('recordMore').onclick = ()=>{ show('s2'); };
$('takesList').addEventListener('click',(e)=>{
  const sel=e.target.closest('[data-sel]'), del=e.target.closest('[data-del]');
  if(sel){ chosenIdx=parseInt(sel.dataset.sel,10); renderTakes(); }
  else if(del){
    const i=parseInt(del.dataset.del,10);
    try{ URL.revokeObjectURL(takes[i].url); }catch{}
    takes.splice(i,1);
    if(chosenIdx===i) chosenIdx=-1; else if(chosenIdx>i) chosenIdx--;
    updateTakesBtn();
    if(!takes.length){ show('s2'); } else renderTakes();
  }
});
$('useTake').onclick = ()=>{ if(chosenIdx>=0) openCaptionsForTake(chosenIdx); };

/* ---------- SCREEN 3: chosen take + captions ---------- */
const pv=$('pv');
function openCaptionsForTake(idx){
  const tk=takes[idx];
  pv.src = tk.url;
  previewCaptions = tk.captions || [];
  $('pvHook').querySelector('span').textContent = $('hook').value.trim();
  $('pvCaption').value = $('caption').value.trim();
  togState.hook=true; togState.cap=true; syncTogUI();
  show('s3');
  try{ pv.currentTime=0; }catch{}
}
const togState={hook:true, cap:true};
function syncTogUI(){
  $('togHook').classList.toggle('on',togState.hook);
  $('togHook').textContent='Hook overlay: '+(togState.hook?'ON':'OFF');
  $('togCap').classList.toggle('on',togState.cap);
  $('togCap').textContent='Captions: '+(togState.cap?'ON':'OFF');
}
$('togHook').onclick=()=>{ togState.hook=!togState.hook; syncTogUI(); };
$('togCap').onclick=()=>{ togState.cap=!togState.cap; syncTogUI(); };

pv.addEventListener('timeupdate', ()=>{
  const t=pv.currentTime;
  // hook visible first ~3.2s
  const showHook = togState.hook && $('hook').value.trim() && t < 3.2;
  $('pvHook').style.display = showHook ? 'block':'none';
  // caption = latest segment whose time <= t
  if(togState.cap && previewCaptions.length){
    let cur=null;
    for(const c of previewCaptions){ if(c.t<=t+0.15) cur=c; else break; }
    if(cur){ $('pvCap').style.display='block'; $('pvCapText').textContent=cur.text; }
    else { $('pvCap').style.display='none'; }
  } else { $('pvCap').style.display='none'; }
});

$('reshoot').onclick=()=>{ renderTakes(); show('s2b'); };   // back to take chooser
$('copyCap').onclick=async()=>{
  try{ await navigator.clipboard.writeText($('pvCaption').value); $('copyCap').textContent='Copied ✓';
    setTimeout(()=>$('copyCap').textContent='Copy caption',1200);
  }catch{ alert('Copy not available — select the text manually.'); }
};
$('shareBtn').onclick=async()=>{
  const tk = takes[chosenIdx]; if(!tk){ return; }
  const ext = tk.blob.type.includes('mp4') ? 'mp4':'webm';
  const file = new File([tk.blob], 'agent-script-take'+(chosenIdx+1)+'.'+ext, {type:tk.blob.type});
  // Try native share with the file (Android Chrome supports this)
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({ files:[file], text:$('pvCaption').value }); return; }catch{ /* fall through */ }
  }
  // Fallback: download
  const a=document.createElement('a'); a.href=tk.url; a.download=file.name; document.body.appendChild(a); a.click(); a.remove();
};

/* ---------- Settings ---------- */
function openSettings(msg){
  $('backend').value = load(LS.backend,'');
  $('secret').value = load(LS.secret,'');
  $('apiKey').value = load(LS.key,'');
  $('model').value = load(LS.model, DEFAULT_MODEL);
  const sm=$('setMsg');
  if(msg){ sm.textContent=msg; sm.style.display='block'; } else { sm.style.display='none'; }
  $('modal').classList.add('open');
  if(msg) setTimeout(()=>{ $('backend').focus(); }, 80);
}
function persistSettings(){
  save(LS.backend,$('backend').value.trim());
  save(LS.secret,$('secret').value.trim());
  save(LS.key,$('apiKey').value.trim());
  save(LS.model,$('model').value);
}
// Auto-save as you type / change — so values survive tapping outside the sheet.
['backend','secret','apiKey'].forEach(id=>$(id).addEventListener('input', persistSettings));
$('model').addEventListener('change', persistSettings);

$('settingsBtn').onclick=()=>openSettings();
$('closeBtn').onclick=()=>{ persistSettings(); $('modal').classList.remove('open'); };
$('modal').addEventListener('click',e=>{ if(e.target===$('modal')){ persistSettings(); $('modal').classList.remove('open'); } });
$('saveBtn').onclick=()=>{ persistSettings(); $('modal').classList.remove('open'); };

/* ---------- Init ---------- */
teleResetPos();
setPauseUI();
syncPresetUI();
syncModeUI();
requestAnimationFrame(teleLoop);
if(!hasAuth()) openSettings('Add your Railway Backend URL, or an Anthropic key, to begin.');
