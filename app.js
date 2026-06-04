(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = {
    subtitles: [],
    activeIndex: -1,
    lastIndex: -1,
    lastWordIndex: -1,
    playerType: 'none',
    yt: null,
    ytReady: false,
    hls: null,
    offset: Number(localStorage.getItem('jm_sync') || 0),
    speed: Number(localStorage.getItem('jm_speed') || 1),
    autoPause: false,
    repeatStart: -1,
    repeatEnd: -1,
    repeatGuardUntil: 0,
    listCenter: 0,
    renderRadius: 28,
    savedWords: readJSON('jm_saved_words', []),
    savedLines: readJSON('jm_saved_lines', []),
    currentDictWord: '',
    saveTimer: null,
    syncTicker: null
  };

  const el = {
    movie: $('moviePlayer'), videoBox: $('videoBox'), emptyVideo: $('emptyVideo'), ytHost: $('ytHost'),
    subtitleDock: $('subtitleDock'), dockEn: $('dockEn'), dockAr: $('dockAr'), statusText: $('statusText'),
    subtitleList: $('subtitleList'), listInfo: $('listInfo'), menuSheet: $('menuSheet'), menuStatus: $('menuStatus'),
    syncValue: $('syncValue'), speedBtn: $('speedBtn'), autoPauseBtn: $('autoPauseBtn'), toast: $('toast')
  };

  function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
  function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function debounceSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveState, 700); }
  function saveState() { localStorage.setItem('jm_subtitles', JSON.stringify(state.subtitles)); localStorage.setItem('jm_sync', String(state.offset)); localStorage.setItem('jm_speed', String(state.speed)); writeJSON('jm_saved_words', state.savedWords); writeJSON('jm_saved_lines', state.savedLines); }
  function toast(msg) { clearTimeout(window.__toastTimer); el.toast.textContent = msg; el.toast.classList.remove('hidden'); window.__toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 1800); }
  function setStatus(msg) { el.statusText.textContent = msg; if (el.menuStatus) el.menuStatus.textContent = msg; }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function plainText(html) { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim(); }
  function cleanLine(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
  function shouldIgnoreSubtitle(text) { const t = cleanLine(text); return !t || /\[[^\]]+\]/.test(t); }
  function formatTime(sec) { sec = Math.max(0, Number(sec) || 0); const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); const s = Math.floor(sec%60); return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`; }
  function parseTime(t) { if (!t) return 0; const p = String(t).replace(',', '.').trim().split(':').map(Number); if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2]; if (p.length === 2) return p[0]*60 + p[1]; return p[0] || 0; }
  function secondsToSrtTime(total) { const ms = Math.round((total - Math.floor(total)) * 1000); const t = Math.max(0, Math.floor(total)); const h = Math.floor(t/3600); const m = Math.floor((t%3600)/60); const s = t%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`; }
  function tokenize(text) { return cleanLine(text).match(/[A-Za-zÀ-ÿ0-9]+(?:[-'][A-Za-zÀ-ÿ0-9]+)*/g) || []; }
  function playphraseUrl(q) { return `https://www.playphrase.me/#/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}`; }
  function openPlayPhrase(q) { if (!q) return; window.open(playphraseUrl(q), '_blank', 'noopener,noreferrer'); }

  function loadScript(src) { return new Promise((resolve, reject) => { const existing = [...document.scripts].find(s => s.src === src); if (existing) return resolve(); const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); }); }

  function parseSrt(content) {
    const blocks = String(content || '').replace(/\r/g, '').trim().split(/\n\s*\n/);
    const out = [];
    for (const block of blocks) {
      const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
      const timeIndex = lines.findIndex(l => l.includes('-->'));
      if (timeIndex < 0) continue;
      const [a, b] = lines[timeIndex].split('-->').map(x => x.trim());
      const textLines = lines.slice(timeIndex + 1);
      if (!textLines.length) continue;
      const ar = textLines.filter(l => /[\u0600-\u06FF]/.test(l)).join('<br>');
      const en = textLines.filter(l => !/[\u0600-\u06FF]/.test(l)).join(' ');
      const text = en || textLines.join(' ');
      if (shouldIgnoreSubtitle(text)) continue;
      out.push({ startTime: parseTime(a), endTime: parseTime(b), en: text, ar, time: formatTime(parseTime(a)) });
    }
    out.sort((x, y) => x.startTime - y.startTime);
    return out;
  }

  function parseHtmlTable(content) {
    const d = document.createElement('div'); d.innerHTML = content;
    const rows = [...d.querySelectorAll('tr')];
    const out = [];
    for (const row of rows) {
      const tds = row.querySelectorAll('td');
      if (tds.length < 2) continue;
      const time = tds[0].innerText.trim();
      const en = tds[1].innerHTML.trim();
      const ar = tds[2]?.innerHTML.trim() || '';
      if (!time.includes(':') || shouldIgnoreSubtitle(en)) continue;
      out.push({ startTime: parseTime(time), endTime: 0, en, ar, time: formatTime(parseTime(time)) });
    }
    for (let i=0;i<out.length;i++) out[i].endTime = Math.min(out[i].startTime + 6, (out[i+1]?.startTime ?? out[i].startTime + 6) - .01);
    return out;
  }

  function handleSubtitleContent(content) {
    const lower = content.toLowerCase();
    state.subtitles = (lower.includes('<table') || lower.includes('<tr')) ? parseHtmlTable(content) : parseSrt(content);
    state.activeIndex = -1; state.lastIndex = -1; state.lastWordIndex = -1; state.listCenter = 0; state.repeatStart = -1; state.repeatEnd = -1;
    setStatus(`${state.subtitles.length} subtitles loaded`);
    renderList(0);
    updateDock(null);
    saveState();
  }

  function findIndexAt(time) {
    let lo = 0, hi = state.subtitles.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const item = state.subtitles[mid];
      if (time < item.startTime) hi = mid - 1;
      else if (time > item.endTime) { ans = mid; lo = mid + 1; }
      else return mid;
    }
    return -1;
  }

  function getMediaTime() {
    if (state.playerType === 'html5') return el.movie.currentTime || 0;
    if (state.playerType === 'youtube' && state.yt?.getCurrentTime) return state.yt.getCurrentTime() || 0;
    return 0;
  }

  function seekMedia(time, play=true) {
    const target = Math.max(0, time - 0.06);
    if (state.playerType === 'html5') { el.movie.currentTime = target; if (play) el.movie.play().catch(()=>{}); el.movie.playbackRate = state.speed; }
    if (state.playerType === 'youtube' && state.yt?.seekTo) { state.yt.seekTo(target, true); if (play) state.yt.playVideo(); if (state.yt.setPlaybackRate) state.yt.setPlaybackRate(state.speed); }
  }

  function updateWordProgress(item, currentTime) {
    const words = tokenize(item.en);
    if (!words.length) return -1;
    const duration = Math.max(.5, item.endTime - item.startTime);
    const ratio = Math.min(1, Math.max(0, (currentTime - item.startTime) / duration));
    return Math.min(words.length - 1, Math.floor(ratio * words.length));
  }

  function wordHtml(text, activeWordIndex = -1) {
    const raw = cleanLine(text);
    const parts = raw.split(/([A-Za-zÀ-ÿ0-9]+(?:[-'][A-Za-zÀ-ÿ0-9]+)*)/g);
    let wordNo = -1;
    return parts.map(part => {
      if (/^[A-Za-zÀ-ÿ0-9]+(?:[-'][A-Za-zÀ-ÿ0-9]+)*$/.test(part)) {
        wordNo++;
        const active = wordNo === activeWordIndex ? ' active' : '';
        return `<span class="word${active}" data-word="${escapeHtml(part)}">${escapeHtml(part)}</span>`;
      }
      return escapeHtml(part);
    }).join('');
  }

  function updateDock(item, wordIndex = -1) {
    if (!item) {
      if (state.lastIndex >= 0) item = state.subtitles[state.lastIndex]; else { el.subtitleDock.classList.add('hidden'); return; }
      wordIndex = state.lastWordIndex;
    }
    el.subtitleDock.classList.remove('hidden');
    el.dockEn.innerHTML = wordHtml(item.en, wordIndex);
    el.dockAr.innerHTML = item.ar || '';
  }

  function syncLoop() {
    if (state.playerType !== 'none' && state.subtitles.length) {
      const now = performance.now();
      const mediaTime = getMediaTime() - state.offset;

      if (state.repeatStart >= 0 && state.repeatEnd >= 0 && now > state.repeatGuardUntil) {
        const end = state.subtitles[state.repeatEnd]?.endTime ?? 0;
        if (mediaTime >= end) {
          state.repeatGuardUntil = now + 360;
          seekMedia(state.subtitles[state.repeatStart].startTime, true);
        }
      }

      let idx = state.activeIndex;
      const current = state.subtitles[idx];
      if (!current || mediaTime < current.startTime || mediaTime > current.endTime) idx = findIndexAt(mediaTime);

      if (idx >= 0) {
        const item = state.subtitles[idx];
        const wordIdx = updateWordProgress(item, mediaTime);
        if (idx !== state.activeIndex || wordIdx !== state.lastWordIndex) {
          state.activeIndex = idx; state.lastIndex = idx; state.lastWordIndex = wordIdx;
          updateDock(item, wordIdx);
          if (Math.abs(idx - state.listCenter) > 14) renderList(idx);
          highlightCard(idx);
        }
        if (state.autoPause && mediaTime >= item.endTime - 0.05 && state.repeatStart < 0) pauseMedia();
      } else if (state.lastIndex >= 0) {
        state.activeIndex = -1;
        updateDock(null);
      }
    }
    state.syncTicker = requestAnimationFrame(syncLoop);
  }

  function pauseMedia() { if (state.playerType === 'html5') el.movie.pause(); if (state.playerType === 'youtube' && state.yt?.pauseVideo) state.yt.pauseVideo(); }

  function renderList(center = state.listCenter) {
    state.listCenter = Math.max(0, Math.min(center, state.subtitles.length - 1));
    const start = Math.max(0, state.listCenter - state.renderRadius);
    const end = Math.min(state.subtitles.length, state.listCenter + state.renderRadius + 1);
    el.listInfo.textContent = state.subtitles.length ? `Showing ${start+1}-${end} of ${state.subtitles.length}` : 'Upload SRT to start';
    const chunks = [];
    if (start > 0) chunks.push(`<button class="small-btn" data-render-center="${Math.max(0,start-state.renderRadius)}">Load previous</button>`);
    for (let i=start; i<end; i++) chunks.push(cardHtml(i, state.subtitles[i]));
    if (end < state.subtitles.length) chunks.push(`<button class="small-btn" data-render-center="${Math.min(state.subtitles.length-1,end+state.renderRadius)}">Load next</button>`);
    el.subtitleList.innerHTML = chunks.join('');
    highlightCard(state.lastIndex);
  }

  function cardHtml(i, item) {
    const active = i === state.lastIndex ? ' active' : '';
    const repeatOn = state.repeatStart >= 0 && i >= state.repeatStart && i <= state.repeatEnd;
    return `<article id="card-${i}" class="subtitle-card${active}" data-index="${i}">
      <div class="card-en">${wordHtml(item.en, i === state.lastIndex ? state.lastWordIndex : -1)}</div>
      <div id="ar-${i}" class="card-ar">${item.ar || ''}</div>
      <div class="card-actions">
        <button class="play-btn" data-play="${i}">العب <span class="time-chip">${item.time}</span></button>
        <button class="repeat-btn" data-repeat="${i}">${repeatOn ? 'Stop loop' : 'Repeat'}</button>
        <button class="line-btn" data-line-menu="${i}">⋯</button>
      </div>
    </article>`;
  }

  function highlightCard(idx) {
    document.querySelectorAll('.subtitle-card.active').forEach(x => x.classList.remove('active'));
    if (idx >= 0) $('card-' + idx)?.classList.add('active');
  }

  function jumpToCard(idx) {
    if (idx < 0) return;
    renderList(idx);
    setTimeout(() => $('card-' + idx)?.scrollIntoView({behavior:'smooth', block:'center'}), 40);
  }

  async function translateMyMemory(text) {
    const res = await fetch('/api/mymemory-translate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text, source:'en', target:'ar' }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.translatedText || '';
  }

  async function translateLine(idx) {
    const item = state.subtitles[idx]; if (!item) return;
    setStatus('Translating line with MyMemory...');
    try { item.ar = await translateMyMemory(cleanLine(item.en)); $('ar-' + idx) && ($('ar-' + idx).innerHTML = escapeHtml(item.ar)); if (idx === state.lastIndex) updateDock(item, state.lastWordIndex); debounceSave(); toast('Line translated'); }
    catch { toast('MyMemory failed'); }
  }

  async function translateAllAzure() {
    const jobs = state.subtitles.map((it, index) => ({ index, text: cleanLine(it.en) })).filter(x => x.text && !state.subtitles[x.index].ar);
    if (!jobs.length) return toast('Nothing to translate');
    openMenu(false); setStatus(`Azure translating ${jobs.length} lines...`);
    const chunkSize = 45;
    let done = 0;
    for (let i=0; i<jobs.length; i+=chunkSize) {
      const items = jobs.slice(i, i+chunkSize);
      let tries = 0;
      while (tries < 3) {
        try {
          const res = await fetch('/api/azure-translate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ items }) });
          if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); tries++; continue; }
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          for (const row of data.translated || []) { if (state.subtitles[row.index]) state.subtitles[row.index].ar = row.ar || ''; done++; }
          setStatus(`Azure translated ${done}/${jobs.length}`); renderList(state.listCenter); debounceSave(); break;
        } catch (e) { tries++; if (tries >= 3) { toast('Azure stopped on one batch'); break; } await new Promise(r => setTimeout(r, 2500)); }
      }
      await new Promise(r => setTimeout(r, 900));
    }
    saveState(); setStatus('Azure translation finished'); toast('Translation finished');
  }

  function speak(text) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang='en-US'; u.rate=.85; speechSynthesis.speak(u); } catch {} }
  function saveWord(word, ar='') { const key = word.toLowerCase(); if (!state.savedWords.some(x => x.word.toLowerCase() === key)) state.savedWords.unshift({word, ar, savedAt:new Date().toISOString()}); writeJSON('jm_saved_words', state.savedWords); toast('Word saved'); }
  function saveLine(idx) { const item = state.subtitles[idx]; if (!item) return; const key = `${Math.round(item.startTime*1000)}-${cleanLine(item.en).slice(0,40)}`; if (!state.savedLines.some(x => x.key === key)) state.savedLines.unshift({...item, key}); writeJSON('jm_saved_lines', state.savedLines); toast('Line saved'); }
  function copyLine(idx) { const item = state.subtitles[idx]; if (!item) return; navigator.clipboard?.writeText(cleanLine(item.en)); toast('Copied'); }

  async function openDict(word, idx = state.lastIndex) {
    word = String(word || '').replace(/[^A-Za-zÀ-ÿ0-9'-]/g, ''); if (!word) return;
    state.currentDictWord = word; $('dictWord').textContent = word; $('dictTranslation').textContent = 'Searching...'; $('dictContext').innerHTML = idx >= 0 ? wordHtml(state.subtitles[idx].en, -1) : ''; $('dictExamples').innerHTML = ''; openModal('dictModal'); speak(word);
    $('dictPlayPhraseBtn').onclick = () => openPlayPhrase(word);
    $('dictSaveBtn').onclick = () => saveWord(word, $('dictTranslation').textContent || '');
    $('dictSpeakBtn').onclick = () => speak(word);
    try { $('dictTranslation').textContent = await translateMyMemory(word); } catch { $('dictTranslation').textContent = 'Translation failed'; }
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const data = await res.json(); const examples = [];
      for (const m of data?.[0]?.meanings || []) for (const d of m.definitions || []) if (d.example) examples.push(d.example);
      $('dictExamples').innerHTML = examples.slice(0,3).map(ex => `<div class="example" dir="ltr">${escapeHtml(ex)}</div>`).join('') || '<div class="example">No examples found.</div>';
    } catch { $('dictExamples').innerHTML = '<div class="example">No examples found.</div>'; }
  }

  function showSaved(type) {
    const body = $('savedBody'); $('savedTitle').textContent = type === 'words' ? 'Saved words' : 'Saved lines';
    const arr = type === 'words' ? state.savedWords : state.savedLines;
    body.innerHTML = arr.length ? arr.map((x, i) => type === 'words'
      ? `<div class="saved-item"><b dir="ltr">${escapeHtml(x.word)}</b><p>${escapeHtml(x.ar || '')}</p><button class="small-btn" data-pp-word="${escapeHtml(x.word)}">PlayPhrase</button></div>`
      : `<div class="saved-item"><b dir="ltr">${escapeHtml(cleanLine(x.en))}</b><p>${escapeHtml(x.ar || '')}</p><button class="small-btn" data-saved-play="${i}">Play</button></div>`).join('')
      : '<p>No saved items yet.</p>';
    openModal('savedModal');
  }

  function openMenu(show=true) { el.menuSheet.classList.toggle('hidden', !show); }
  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }
  function updateControls() { el.syncValue.textContent = `${state.offset.toFixed(2)}s`; el.speedBtn.textContent = `${state.speed.toFixed(1)}x`; el.autoPauseBtn.textContent = state.autoPause ? 'On' : 'Off'; }

  async function loadUrl(url) {
    url = String(url || '').trim(); if (!url) return;
    closeModal('urlModal');
    const yt = extractYtId(url);
    el.emptyVideo.classList.add('hidden');
    if (yt) return loadYouTube(yt);
    state.playerType = 'html5'; el.ytHost.classList.add('hidden'); el.movie.classList.remove('hidden'); destroyHls();
    if (/\.m3u8(?:[?#]|$)/i.test(url)) await attachHls(url); else { el.movie.src = url; el.movie.play().catch(()=>{}); }
    el.movie.playbackRate = state.speed; setStatus('Video loaded');
  }

  function extractYtId(url) { const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/); return m?.[1] || null; }
  async function loadYouTube(id) { state.playerType = 'youtube'; el.movie.classList.add('hidden'); el.ytHost.classList.remove('hidden'); if (!window.YT?.Player) { await loadScript('https://www.youtube.com/iframe_api'); await new Promise(r => { window.onYouTubeIframeAPIReady = r; setTimeout(r, 1500); }); } if (state.yt?.loadVideoById) state.yt.loadVideoById(id); else state.yt = new YT.Player('ytPlayer', { videoId:id, playerVars:{playsinline:1, rel:0, modestbranding:1}, events:{onReady:e=>{e.target.playVideo(); if (e.target.setPlaybackRate) e.target.setPlaybackRate(state.speed);}} }); }
  function destroyHls() { if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; } }
  async function attachHls(url) { if (el.movie.canPlayType('application/vnd.apple.mpegurl')) { el.movie.src = url; el.movie.play().catch(()=>{}); return; } await loadScript('https://cdn.jsdelivr.net/npm/hls.js@latest'); if (window.Hls?.isSupported()) { state.hls = new Hls({enableWorker:true, backBufferLength:60}); state.hls.loadSource(url); state.hls.attachMedia(el.movie); el.movie.play().catch(()=>{}); } else toast('HLS not supported'); }

  document.addEventListener('click', e => {
    const wordEl = e.target.closest('.word'); if (wordEl) { e.stopPropagation(); openDict(wordEl.dataset.word, Number(e.target.closest('[data-index]')?.dataset.index ?? state.lastIndex)); return; }
    const renderBtn = e.target.closest('[data-render-center]'); if (renderBtn) return renderList(Number(renderBtn.dataset.renderCenter));
    const play = e.target.closest('[data-play]'); if (play) { const i = Number(play.dataset.play); state.repeatStart = -1; state.repeatEnd = -1; state.activeIndex = i; state.lastIndex = i; renderList(i); updateDock(state.subtitles[i], -1); seekMedia(state.subtitles[i].startTime, true); return; }
    const rep = e.target.closest('[data-repeat]'); if (rep) { const i = Number(rep.dataset.repeat); if (state.repeatStart === i && state.repeatEnd === i) { state.repeatStart = state.repeatEnd = -1; toast('Repeat off'); } else { state.repeatStart = state.repeatEnd = i; seekMedia(state.subtitles[i].startTime, true); toast('Repeat on'); } renderList(i); return; }
    const lineMenu = e.target.closest('[data-line-menu]'); if (lineMenu) { const i = Number(lineMenu.dataset.lineMenu); const action = prompt('Type: copy / translate / save / playphrase', 'translate'); if (action === 'copy') copyLine(i); if (action === 'translate') translateLine(i); if (action === 'save') saveLine(i); if (action === 'playphrase') openPlayPhrase(cleanLine(state.subtitles[i].en)); return; }
    const ppWord = e.target.closest('[data-pp-word]'); if (ppWord) openPlayPhrase(ppWord.dataset.ppWord);
    if (e.target.matches('[data-close-modal]')) closeModal(e.target.dataset.closeModal);
  });

  $('menuBtn').onclick = () => openMenu(true); $('closeMenuBtn').onclick = () => openMenu(false); document.querySelector('.sheet-backdrop').onclick = () => openMenu(false);
  $('urlBtn').onclick = () => openModal('urlModal'); $('loadUrlBtn').onclick = () => loadUrl($('videoUrlInput').value);
  $('videoFileInput').onchange = e => { const f = e.target.files[0]; if (f) loadUrl(URL.createObjectURL(f)); };
  $('subtitleFileInput').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => handleSubtitleContent(r.result); r.readAsText(f); };
  $('menuUploadSrt').onclick = () => { openMenu(false); $('subtitleFileInput').click(); };
  $('menuAzure').onclick = translateAllAzure;
  $('menuSavedWords').onclick = () => { openMenu(false); showSaved('words'); };
  $('menuSavedLines').onclick = () => { openMenu(false); showSaved('lines'); };
  $('menuClear').onclick = () => { if(confirm('Start a new lesson?')) { localStorage.removeItem('jm_subtitles'); state.subtitles=[]; state.activeIndex=-1; state.lastIndex=-1; renderList(0); updateDock(null); openMenu(false); } };
  $('speedBtn').onclick = () => { const opts=[.5,.75,1,1.25,1.5,2]; state.speed = opts[(opts.indexOf(state.speed)+1)%opts.length] || 1; if (state.playerType === 'html5') el.movie.playbackRate = state.speed; if (state.yt?.setPlaybackRate) state.yt.setPlaybackRate(state.speed); updateControls(); debounceSave(); };
  $('syncMinus').onclick = () => { state.offset -= .25; updateControls(); debounceSave(); };
  $('syncPlus').onclick = () => { state.offset += .25; updateControls(); debounceSave(); };
  $('autoPauseBtn').onclick = () => { state.autoPause = !state.autoPause; updateControls(); };
  $('goActiveBtn').onclick = () => jumpToCard(state.lastIndex >= 0 ? state.lastIndex : 0);
  el.subtitleDock.onclick = () => jumpToCard(state.lastIndex);
  $('saveLineBtn').onclick = () => saveLine(state.lastIndex);
  $('copyLineBtn').onclick = () => copyLine(state.lastIndex);
  $('translateLineBtn').onclick = () => translateLine(state.lastIndex);
  $('playPhraseLineBtn').onclick = () => { const item = state.subtitles[state.lastIndex]; if (item) openPlayPhrase(cleanLine(item.en)); };

  el.movie.addEventListener('loadedmetadata', () => { el.movie.playbackRate = state.speed; });

  const savedSubs = readJSON('jm_subtitles', []); if (savedSubs.length) { state.subtitles = savedSubs.filter(x => !shouldIgnoreSubtitle(x.en)); renderList(0); setStatus(`${state.subtitles.length} subtitles restored`); }
  updateControls(); syncLoop();
})();
