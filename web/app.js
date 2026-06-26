/* Agent Script — Shoot Prototype (throwaway, web). Validates the loop:
   script → teleprompter record → live captions + hook overlay → preview → save. */

const $ = (id)=>document.getElementById(id);
const LS = { key:'asp_key', model:'asp_model', backend:'asp_backend', secret:'asp_secret' };
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
async function generateScript(idea){
  const model = load(LS.model,'claude-haiku-4-5-20251001');
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
      method:'POST', headers, body: JSON.stringify({ idea, model }),
    });
    if(!res.ok){
      let d=''; try{ const j=await res.json(); d=j.detail || JSON.stringify(j); }catch{ d=await res.text(); }
      if(res.status===401) throw new Error('Backend rejected the request (app secret mismatch?).');
      throw new Error(`Backend error ${res.status}: ${d}`);
    }
    const j = await res.json();
    return { hook:j.hook||'', say:j.say||'', caption:j.caption||'' };
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

$('genBtn').onclick = async ()=>{
  const idea = $('idea').value.trim();
  const err = $('genErr'); err.textContent='';
  if(!hasAuth()){ openSettings('Add your Railway Backend URL (or an Anthropic key) first.'); return; }
  if(!idea){ err.textContent='Type an idea (or tap a suggestion).'; return; }
  const btn=$('genBtn'); btn.disabled=true; const old=btn.textContent; btn.textContent='Writing…';
  try{
    const p = await generateScript(idea);
    $('hook').value = p.hook;
    $('say').value = p.say;
    $('caption').value = p.caption;
    $('scriptCard').style.display='block';
    $('scriptCard').scrollIntoView({behavior:'smooth'});
  }catch(e){
    if((e.message||'')==='NO_AUTH'){ openSettings('Add your Railway Backend URL (or an Anthropic key) first.'); }
    else err.textContent = e.message || String(e);
  }
  finally{ btn.disabled=false; btn.textContent=old; }
};

$('toRecord').onclick = ()=>{
  // push current script into the record stage
  const hook = $('hook').value.trim();
  $('teleText').textContent = $('say').value.trim() || '(no script — you can still record)';
  const ho = $('hookOverlay').querySelector('span');
  ho.textContent = hook;
  $('hookOverlay').style.display = hook ? 'block' : 'none';
  show('s2');
  startCamera();
};

/* ---------- SCREEN 2: camera + teleprompter + record ---------- */
let stream=null, recorder=null, chunks=[], facing='environment';
let recording=false, recStart=0, recTimer=null;
let captions=[];            // [{t:secondsSinceStart, text}]
let recog=null, capOn=true, interimText='';

async function startCamera(){
  try{
    if(stream){ stream.getTracks().forEach(t=>t.stop()); }
    stream = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode: facing, width:{ideal:1080}, height:{ideal:1920} },
      audio:true,
    });
    $('cam').srcObject = stream;
  }catch(e){
    alert('Camera/mic blocked or unavailable.\n\nMake sure you opened this over HTTPS (the Netlify URL) and allowed camera + microphone.\n\n'+(e.message||e));
    show('s1');
  }
}

$('flipCam').onclick = ()=>{ facing = (facing==='environment')?'user':'environment'; startCamera(); };
$('backToScript').onclick = ()=>{ stopCamera(); show('s1'); };
function stopCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } }

/* teleprompter auto-scroll */
let teleY=0, teleRAF=null, teleLast=0, teleRun=false;
function teleLoop(ts){
  if(!teleRun){ teleLast=ts; teleRAF=requestAnimationFrame(teleLoop); return; }
  if(!teleLast) teleLast=ts;
  const dt=(ts-teleLast)/1000; teleLast=ts;
  const speed = parseInt($('speed').value,10); // 0..100
  teleY -= dt * speed * 1.6;                    // px/sec
  const inner=$('teleInner'); const tele=$('tele');
  const maxScroll = inner.offsetHeight - tele.offsetHeight*0.2;
  if(-teleY > maxScroll) teleY = -maxScroll;
  inner.style.transform = `translateY(${teleY}px)`;
  teleRAF=requestAnimationFrame(teleLoop);
}
function teleResetPos(){ teleY = $('tele').offsetHeight*0.5; $('teleInner').style.transform=`translateY(${teleY}px)`; }
$('teleReset').onclick = ()=>{ teleResetPos(); };
$('tele').onclick = ()=>{ teleRun = !teleRun; };   // tap teleprompter to pause/resume

/* live captions via Web Speech (best effort, degrades gracefully) */
$('capToggle').onclick = ()=>{
  capOn = !capOn;
  $('capToggle').style.opacity = capOn ? '1':'.4';
  if(!capOn){ $('liveCap').style.display='none'; stopRecog(); }
};
function startRecog(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR || !capOn){ return; }
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
      const live = interimText || (captions.length? captions[captions.length-1].text : '');
      if(live && capOn){ $('liveCap').style.display='block'; $('liveCapText').textContent = live; }
    };
    recog.onerror = ()=>{ /* mic contention / network — degrade silently */ };
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
  const mime=pickMime();
  try{ recorder = mime? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream); }
  catch(e){ alert('Recording not supported on this browser: '+(e.message||e)); return; }
  recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = onRecStop;
  recorder.start();
  recording=true; recStart=performance.now();
  $('recBtn').classList.add('recording');
  $('recTime').classList.add('on');
  teleRun=true;                          // start teleprompter scroll
  startRecog();
  recTimer=setInterval(()=>{
    const s=Math.floor((performance.now()-recStart)/1000);
    $('recElapsed').textContent = Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
  },250);
}
function stopRec(){
  recording=false; teleRun=false;
  clearInterval(recTimer);
  $('recBtn').classList.remove('recording');
  $('recTime').classList.remove('on');
  stopRecog();
  try{ recorder.stop(); }catch{}
}

let lastBlob=null, lastUrl=null;
function onRecStop(){
  const type = (chunks[0] && chunks[0].type) || 'video/webm';
  lastBlob = new Blob(chunks, {type});
  if(lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(lastBlob);
  goPreview();
}

/* ---------- SCREEN 3: preview with synced overlays ---------- */
const pv=$('pv');
function goPreview(){
  pv.src = lastUrl;
  // hook overlay text
  const hook=$('hook').value.trim();
  $('pvHook').querySelector('span').textContent = hook;
  $('pvCaption').value = $('caption').value.trim();
  // reset toggles to on
  togState.hook=true; togState.cap=true; syncTogUI();
  show('s3');
  pv.currentTime=0;
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
  if(togState.cap && captions.length){
    let cur=null;
    for(const c of captions){ if(c.t<=t+0.15) cur=c; else break; }
    if(cur){ $('pvCap').style.display='block'; $('pvCapText').textContent=cur.text; }
    else { $('pvCap').style.display='none'; }
  } else { $('pvCap').style.display='none'; }
});

$('reshoot').onclick=()=>{ show('s2'); };   // stream still live
$('copyCap').onclick=async()=>{
  try{ await navigator.clipboard.writeText($('pvCaption').value); $('copyCap').textContent='Copied ✓';
    setTimeout(()=>$('copyCap').textContent='Copy caption',1200);
  }catch{ alert('Copy not available — select the text manually.'); }
};
$('shareBtn').onclick=async()=>{
  if(!lastBlob){ return; }
  const ext = lastBlob.type.includes('mp4') ? 'mp4':'webm';
  const file = new File([lastBlob], 'agent-script-clip.'+ext, {type:lastBlob.type});
  // Try native share with the file (Android Chrome supports this)
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({ files:[file], text:$('pvCaption').value }); return; }catch{ /* fall through */ }
  }
  // Fallback: download
  const a=document.createElement('a'); a.href=lastUrl; a.download=file.name; document.body.appendChild(a); a.click(); a.remove();
};

/* ---------- Settings ---------- */
function openSettings(msg){
  $('backend').value = load(LS.backend,'');
  $('secret').value = load(LS.secret,'');
  $('apiKey').value = load(LS.key,'');
  $('model').value = load(LS.model,'claude-haiku-4-5-20251001');
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
requestAnimationFrame(teleLoop);
if(!hasAuth()) openSettings('Add your Railway Backend URL, or an Anthropic key, to begin.');
