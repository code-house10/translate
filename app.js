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
    repeatWaiting: false,
    repeatTimer: null,
    repeatDelaySeconds: Math.min(5, Math.max(1, Number(localStorage.getItem('jm_repeat_delay') || 1))),
    listCenter: 0,
    renderRadius: 28,
    savedWords: readJSON('jm_saved_words', []),
    savedLines: readJSON('jm_saved_lines', []),
    currentDictWord: '',
    currentDictExamples: [],
    saveTimer: null,
    syncTicker: null,
    cloudClient: null,
    cloudLessons: [],
    cloudSyncTimer: null,
    cloudSyncInProgress: false,
    cloudSyncPending: false,
    cloudLastSyncAt: localStorage.getItem('jm_cloud_last_sync_at') || '',
    reviewQueue: [],
    reviewIndex: 0,
    reviewRevealed: false,
    isSeeking: false,
    seekGuardUntil: 0,
    lastSeekTarget: 0,
    lastSeekSubtitleTime: 0,
    hlsReady: false,
    videoBlobUrl: '',
    usingCachedVideo: false,
    cacheDbPromise: null
  };

  const el = {
    movie: $('moviePlayer'), videoBox: $('videoBox'), emptyVideo: $('emptyVideo'), ytHost: $('ytHost'),
    subtitleDock: $('subtitleDock'), dockEn: $('dockEn'), dockAr: $('dockAr'), statusText: $('statusText'),
    subtitleList: $('subtitleList'), listInfo: $('listInfo'), menuSheet: $('menuSheet'), menuStatus: $('menuStatus'),
    syncValue: $('syncValue'), speedBtn: $('speedBtn'), autoPauseBtn: $('autoPauseBtn'), repeatDelayValue: $('repeatDelayValue'), toast: $('toast')
  };

  function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
  function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function debounceSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveState, 700); }
  function saveState() {
    localStorage.setItem('jm_subtitles', JSON.stringify(state.subtitles));
    localStorage.setItem('jm_sync', String(state.offset));
    localStorage.setItem('jm_speed', String(state.speed));
    localStorage.setItem('jm_repeat_delay', String(state.repeatDelaySeconds));
    // Keep last lesson open on next visit. Browser blob: URLs cannot be restored after reload,
    // so only permanent video links are saved automatically.
    localStorage.setItem('jm_video_url', state.videoUrl && !String(state.videoUrl).startsWith('blob:') ? state.videoUrl : '');
    localStorage.setItem('jm_last_lesson_saved_at', new Date().toISOString());
    writeJSON('jm_saved_words', state.savedWords);
    writeJSON('jm_saved_lines', state.savedLines);
  }
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

  const PHRASAL_PARTICLES = new Set(['up','out','off','on','in','down','over','away','back','around','through','about','along','across','after','by','forward','together']);
  const COMMON_PHRASES = [
    'work out','figure out','find out','look up','look after','look for','look forward to','give up','give in','give back',
    'get down','get up','get out','get in','get over','get away','get away with','get back','get through','get along',
    'take off','take out','take over','take back','take down','pick up','put down','put up','put up with','come up','come up with',
    'turn out','turn up','turn down','turn off','turn on','go on','go off','go back','go through','break down','break up',
    'make up','make out','bring up','bring back','set up','hold on','keep up','keep on','keep out','keep away',
    'keep my head down','keep your head down','keep his head down','keep her head down','keep their head down',
    'fucked up','fuck up','mess up','calm down','slow down','knock it down','pay back','leave out','left out'
  ];
  const IRREGULAR_BASE = { worked:'work', working:'work', works:'work', figured:'figure', figuring:'figure', figures:'figure', found:'find', finding:'find', finds:'find', looked:'look', looking:'look', looks:'look', gave:'give', given:'give', giving:'give', gives:'give', got:'get', gotten:'get', getting:'get', gets:'get', took:'take', taken:'take', taking:'take', takes:'take', picked:'pick', picking:'pick', picks:'pick', put:'put', putting:'put', puts:'put', came:'come', coming:'come', comes:'come', turned:'turn', turning:'turn', turns:'turn', went:'go', gone:'go', going:'go', goes:'go', broke:'break', broken:'break', breaking:'break', breaks:'break', made:'make', making:'make', makes:'make', brought:'bring', bringing:'bring', brings:'bring', set:'set', setting:'set', sets:'set', held:'hold', holding:'hold', holds:'hold', kept:'keep', keeping:'keep', keeps:'keep', fucked:'fuck', fucking:'fuck', fucks:'fuck', messed:'mess', messing:'mess', messes:'mess', paid:'pay', paying:'pay', pays:'pay', left:'leave', leaving:'leave', leaves:'leave' };

  function baseVerb(token) {
    const t = String(token || '').toLowerCase();
    if (IRREGULAR_BASE[t]) return IRREGULAR_BASE[t];
    if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
    if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
    if (t.length > 4 && t.endsWith('s')) return t.slice(0, -1);
    return t;
  }

  function detectPhrasesInLine(line, clickedWord = '') {
    const lower = cleanLine(line).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const clicked = String(clickedWord || '').toLowerCase();
    const words = lower.match(/[a-z0-9']+/g) || [];
    const found = new Map();
    const add = (phrase, matched = '') => {
      phrase = String(phrase || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!phrase || !phrase.includes(' ')) return;
      if (clicked && !phrase.split(' ').some(w => w === clicked || baseVerb(w) === baseVerb(clicked))) return;
      found.set(phrase, matched || phrase);
    };
    COMMON_PHRASES.forEach(p => {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(lower)) add(p, p);
    });
    for (let i = 0; i < words.length - 1; i++) {
      const first = baseVerb(words[i]);
      const second = words[i + 1];
      if (PHRASAL_PARTICLES.has(second)) add(`${first} ${second}`, `${words[i]} ${second}`);
    }
    for (let i = 0; i < words.length - 2; i++) {
      const first = baseVerb(words[i]);
      const second = words[i + 1];
      const third = words[i + 2];
      if (PHRASAL_PARTICLES.has(third) || ['with','to','for','of','from','at'].includes(third)) add(`${first} ${second} ${third}`, `${words[i]} ${second} ${third}`);
    }
    return [...found.entries()].map(([phrase, matched]) => ({ phrase, matched }));
  }

  async function translatePhraseInContext(phrase, contextEn = '') {
    phrase = String(phrase || '').trim();
    contextEn = cleanLine(contextEn);
    if (!phrase) return '';
    try {
      const res = await fetch('/api/lara-translate', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(getLaraPayload({
          text: `Phrase: ${phrase}\nMovie context: ${contextEn}`,
          instructions: [
            'Return only the short natural Arabic meaning of the English phrase in this movie context.',
            'Do not translate the whole context sentence.',
            'Do not add explanations, labels, notes, or quotation marks.',
            'Use concise Arabic suitable for a flashcard.'
          ]
        }))
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.translatedText) return String(data.translatedText).trim();
    } catch (e) { console.warn('Lara phrase translation failed:', e); }
    try { return await translateMyMemory(phrase); } catch { return ''; }
  }


  const TEMPLATE_RULES = [
    {
      name: 'Repeated warning',
      re: /^how many times have i told you not to (.+?)([?.!]*)$/i,
      build: m => ({
        pattern: 'How many times have I told you not to [do something]?',
        slot: m[1],
        usageEn: 'Use it when you are annoyed because someone keeps doing something you warned them not to do.',
        usageAr: 'تستخدمها عندما تكون منزعجًا لأن شخصًا يكرر شيئًا حذرته منه أكثر من مرة.',
        examples: [
          { en: 'How many times have I told you not to touch my phone?', ar: 'كم مرة قلت لك ألا تلمس هاتفي؟' },
          { en: 'How many times have I told you not to interrupt me?', ar: 'كم مرة قلت لك ألا تقاطعني؟' },
          { en: 'How many times have I told you not to leave the door open?', ar: 'كم مرة قلت لك ألا تترك الباب مفتوحًا؟' }
        ]
      })
    },
    {
      name: 'Shouldn’t you be…?',
      re: /^(?:hey,?\s*)?should(?:n['’]t| not) you be (.+?)([?.!]*)$/i,
      build: m => ({
        pattern: "Shouldn't you be [somewhere / doing something]?",
        slot: m[1],
        usageEn: 'Use it to remind someone of where they should be or what they should be doing now.',
        usageAr: 'تستخدمها لتذكير شخص بالمكان الذي يفترض أن يكون فيه أو الشيء الذي يفترض أن يفعله الآن.',
        examples: [
          { en: "Shouldn't you be at school?", ar: 'ألا يفترض أن تكون في المدرسة؟' },
          { en: "Shouldn't you be getting ready?", ar: 'ألا يفترض أن تكون تستعد؟' },
          { en: "Shouldn't you be working right now?", ar: 'ألا يفترض أن تكون تعمل الآن؟' }
        ]
      })
    },
    {
      name: 'I got some time',
      re: /^(?:nah,?\s*)?i (?:got|have got|have) some time\.?$/i,
      build: () => ({
        pattern: 'I got some time.',
        slot: 'some time',
        usageEn: 'Use it when you want to say you are not in a hurry and have a little free time.',
        usageAr: 'تستخدمها عندما تريد أن تقول إن لديك بعض الوقت ولست مستعجلًا.',
        examples: [
          { en: 'I got some time before class.', ar: 'لدي بعض الوقت قبل الحصة.' },
          { en: 'I got some time if you want to talk.', ar: 'لدي بعض الوقت إذا أردت أن نتكلم.' },
          { en: 'I got some time before the meeting.', ar: 'لدي بعض الوقت قبل الاجتماع.' }
        ]
      })
    },
    {
      name: 'Besides, I wanna…',
      re: /^(?:besides,?\s*)?i (?:wanna|want to) (.+?)([.!?]*)$/i,
      build: m => ({
        pattern: 'Besides, I wanna [do something].',
        slot: m[1],
        usageEn: 'Use it to add another reason for what you want to do.',
        usageAr: 'تستخدمها عندما تضيف سببًا آخر لما تريد فعله.',
        examples: [
          { en: 'Besides, I wanna finish this episode.', ar: 'وبعدين أنا عايز أنهي الحلقة دي.' },
          { en: 'Besides, I wanna talk to him first.', ar: 'ثم إنني أريد أن أتحدث معه أولًا.' },
          { en: 'Besides, I wanna make sure everything is okay.', ar: 'وفوق ذلك أريد أن أتأكد أن كل شيء بخير.' }
        ]
      })
    },
    {
      name: 'You like…?',
      re: /^(?:oh,?\s*)?you like (.+?)([?.!]*)$/i,
      build: m => ({
        pattern: 'You like [something]?',
        slot: m[1],
        usageEn: 'Use it in casual conversation when you discover someone likes something.',
        usageAr: 'تستخدمها في الكلام العادي عندما تكتشف أن شخصًا يحب شيئًا ما.',
        examples: [
          { en: 'You like this song?', ar: 'هل تحب هذه الأغنية؟' },
          { en: 'You like horror movies?', ar: 'هل تحب أفلام الرعب؟' },
          { en: 'You like that place?', ar: 'هل يعجبك ذلك المكان؟' }
        ]
      })
    },
    {
      name: 'I love…',
      re: /^i love (.+?)([!.]*)$/i,
      build: m => ({
        pattern: 'I love [something]!',
        slot: m[1],
        usageEn: 'Use it to react strongly and positively to something you really like.',
        usageAr: 'تستخدمها عندما تعبر بحماس أنك تحب شيئًا جدًا.',
        examples: [
          { en: 'I love that idea!', ar: 'أحب هذه الفكرة جدًا!' },
          { en: 'I love this show!', ar: 'أنا أحب هذا البرنامج!' },
          { en: 'I love the way you said that.', ar: 'أحب الطريقة التي قلت بها ذلك.' }
        ]
      })
    },
    {
      name: 'I did everything I could to…',
      re: /^i did everything i could to (.+?)([.!?]*)$/i,
      build: m => ({
        pattern: 'I did everything I could to [do something].',
        slot: m[1],
        usageEn: 'Use it when you want to say you tried your best to make something happen.',
        usageAr: 'تستخدمها عندما تريد أن تقول إنك بذلت كل ما تستطيع لتحقيق شيء ما.',
        examples: [
          { en: 'I did everything I could to help him.', ar: 'فعلت كل ما بوسعي لمساعدته.' },
          { en: 'I did everything I could to fix it.', ar: 'فعلت كل ما بوسعي لإصلاحه.' },
          { en: 'I did everything I could to reach her.', ar: 'فعلت كل ما بوسعي للتواصل معها.' }
        ]
      })
    },
    {
      name: 'By now you have worked out…',
      re: /^(?:and )?i['’]?m sure by now you['’]?ve (?:worked|figured) out (.+?)([.!?]*)$/i,
      build: m => ({
        pattern: "I'm sure by now you've worked out [something].",
        slot: m[1],
        usageEn: 'Use it when you think the other person has already understood or figured something out.',
        usageAr: 'تستخدمها عندما تعتقد أن الشخص الآخر فهم أو استنتج الأمر بالفعل.',
        examples: [
          { en: "I'm sure by now you've worked out the truth.", ar: 'أنا متأكد أنك الآن اكتشفت الحقيقة.' },
          { en: "I'm sure by now you've figured out what happened.", ar: 'أنا متأكد أنك الآن فهمت ما حدث.' },
          { en: "I'm sure by now you've worked out why I left.", ar: 'أنا متأكد أنك الآن عرفت لماذا رحلت.' }
        ]
      })
    }
  ];

  function genericTemplateFromLine(line) {
    const text = cleanLine(line).replace(/\s+/g, ' ').trim();
    if (!text || text.length < 12) return null;
    let pattern = text;
    pattern = pattern.replace(/"[^"]+"|'[^']+'/g, '[title / name / phrase]');
    pattern = pattern.replace(/\bto\s+([a-z]+(?:\s+[a-z]+){0,5})([.!?]*)$/i, 'to [do something]$2');
    pattern = pattern.replace(/\b(my|your|his|her|our|their)\s+[a-z]+\b/gi, '$1 [thing]');
    if (pattern === text) {
      const words = tokenize(text);
      if (words.length < 5) return null;
      pattern = words.slice(0, Math.min(5, words.length)).join(' ') + ' [...]';
    }
    return {
      pattern,
      slot: '',
      name: 'General reusable pattern',
      usageEn: 'Use this as a reusable sentence frame. Replace the bracketed part with your own situation.',
      usageAr: 'استخدمه كقالب جملة قابل للتغيير. بدّل الجزء بين الأقواس حسب موقفك.',
      examples: [
        { en: pattern, ar: 'استخدم نفس القالب وغيّر الجزء بين الأقواس حسب الموقف.' },
        { en: pattern.replace('[do something]', 'talk to him').replace('[something]', 'this show').replace('[...]', 'in my own situation'), ar: 'مثال تطبيقي باستخدام نفس القالب في موقف مختلف.' }
      ]
    };
  }

  function extractTemplateFromLine(line) {
    const text = cleanLine(line).replace(/^[-–—]\s*/, '').trim();
    if (!text || shouldIgnoreSubtitle(text)) return null;
    for (const rule of TEMPLATE_RULES) {
      const m = text.match(rule.re);
      if (m) return { ...rule.build(m), source: text, rule: rule.name };
    }
    return genericTemplateFromLine(text);
  }

  async function translateTemplateMeaning(template, contextEn = '') {
    if (!template?.pattern) return '';
    try {
      const res = await fetch('/api/lara-translate', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(getLaraPayload({
          text: `Template: ${template.pattern}\nUsage: ${template.usageEn || ''}\nMovie context: ${contextEn}`,
          instructions: [
            'Return only a concise Arabic explanation of when to use this English sentence template.',
            'Do not translate the whole movie context.',
            'Keep it suitable for a flashcard.'
          ]
        }))
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.translatedText) return String(data.translatedText).trim();
    } catch (e) { console.warn('Lara template translation failed:', e); }
    return template.usageAr || '';
  }

  const CLOUD_CONFIG = {
    url: 'https://gyybwibqkasakgwfpkxz.supabase.co',
    key: 'sb_publishable_ZvjDNnkXMcXMrmVQDdWQwg_mSJPKW8L',
    userCode: 'Romioo@1985'
  };
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  function lineKey(item) {
    return `${Math.round((item?.startTime || 0) * 1000)}-${cleanLine(item?.en || '').slice(0, 80).toLowerCase()}`;
  }

  function normalizeSavedLine(line) {
    const now = new Date().toISOString();
    return {
      ...line,
      key: line.key || lineKey(line),
      ar: line.ar || '',
      savedAt: line.savedAt || now,
      dueAt: line.dueAt || now,
      intervalDays: Number(line.intervalDays || 0),
      ease: Number(line.ease || 2.5),
      reviewCount: Number(line.reviewCount || 0),
      lastReviewedAt: line.lastReviewedAt || ''
    };
  }


  function wordKey(word) {
    return `word:${String(word || '').trim().toLowerCase()}`;
  }

  function normalizeSavedWord(word) {
    const now = new Date().toISOString();
    const cleanWord = String(word?.word || '').trim();
    const explicitKind = String(word?.kind || '').toLowerCase();
    const kind = explicitKind === 'template' ? 'template' : (explicitKind === 'phrase' || /\s+/.test(cleanWord) ? 'phrase' : 'word');
    return {
      ...word,
      kind,
      word: cleanWord,
      key: word.key || wordKey(cleanWord),
      ar: word.ar || '',
      contextEn: word.contextEn || '',
      contextAr: word.contextAr || '',
      examples: Array.isArray(word.examples) ? word.examples : [],
      sourceLineKey: word.sourceLineKey || '',
      startTime: Number(word.startTime || 0),
      savedAt: word.savedAt || now,
      dueAt: word.dueAt || now,
      intervalDays: Number(word.intervalDays || 0),
      ease: Number(word.ease || 2.5),
      reviewCount: Number(word.reviewCount || 0),
      lastReviewedAt: word.lastReviewedAt || ''
    };
  }

  function loadScript(src) { return new Promise((resolve, reject) => { const existing = [...document.scripts].find(s => s.src === src); if (existing) return resolve(); const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); }); }



  function savedWordMergeKey(item) {
    const kind = String(item?.kind || 'word').toLowerCase();
    return `${kind}:${String(item?.word || '').trim().toLowerCase()}`;
  }

  function savedLineMergeKey(item) {
    return String(item?.key || lineKey(item) || `${Math.round((item?.startTime || 0) * 1000)}:${cleanLine(item?.en || '').slice(0, 80).toLowerCase()}`);
  }

  function itemDateValue(item) {
    const raw = item?.updatedAt || item?.lastReviewedAt || item?.savedAt || item?.createdAt || '';
    const t = raw ? Date.parse(raw) : 0;
    return Number.isFinite(t) ? t : 0;
  }

  function mergeByKey(localArr, remoteArr, keyFn, normalizeFn) {
    const map = new Map();
    const put = (item, source) => {
      const normalized = normalizeFn(item);
      const key = keyFn(normalized);
      if (!key || key === 'word:' || key === 'phrase:') return;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...normalized, _source: source });
        return;
      }
      const existingDate = itemDateValue(existing);
      const incomingDate = itemDateValue(normalized);
      const chosen = incomingDate >= existingDate
        ? { ...existing, ...normalized }
        : { ...normalized, ...existing };
      // Preserve review metadata conservatively so progress is not lost.
      chosen.reviewCount = Math.max(Number(existing.reviewCount || 0), Number(normalized.reviewCount || 0));
      chosen.knownCount = Math.max(Number(existing.knownCount || 0), Number(normalized.knownCount || 0));
      const dueA = existing.dueAt ? Date.parse(existing.dueAt) : 0;
      const dueB = normalized.dueAt ? Date.parse(normalized.dueAt) : 0;
      if (dueA && dueB) chosen.dueAt = dueA <= dueB ? existing.dueAt : normalized.dueAt;
      else chosen.dueAt = existing.dueAt || normalized.dueAt || chosen.dueAt;
      map.set(key, chosen);
    };
    (remoteArr || []).forEach(x => put(x, 'remote'));
    (localArr || []).forEach(x => put(x, 'local'));
    return [...map.values()].map(({_source, ...x}) => normalizeFn(x));
  }

  function normalizeLibraryState() {
    state.savedWords = state.savedWords.map(normalizeSavedWord).filter(x => x.word && !isLaraSettingsCloudItem(x));
    state.savedLines = state.savedLines.map(normalizeSavedLine).filter(x => x.en || x.ar);
  }

  function cloudSyncLabel() {
    return state.cloudLastSyncAt ? `Last cloud sync: ${new Date(state.cloudLastSyncAt).toLocaleString()}` : 'Not synced yet';
  }

  const VIDEO_CACHE_DB = 'jungle_movie_video_cache_v1';
  const VIDEO_CACHE_STORE = 'videos';

  function isCacheableVideoUrl(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return false;
    if (extractYtId(url)) return false;
    if (/\.m3u8(?:[?#]|$)/i.test(url)) return false;
    return true;
  }

  function openVideoCacheDb() {
    if (state.cacheDbPromise) return state.cacheDbPromise;
    state.cacheDbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not supported on this browser.'));
      const req = indexedDB.open(VIDEO_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(VIDEO_CACHE_STORE)) db.createObjectStore(VIDEO_CACHE_STORE, { keyPath: 'url' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Cannot open video cache.'));
    });
    return state.cacheDbPromise;
  }

  async function getCachedVideo(url) {
    try {
      const db = await openVideoCacheDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(VIDEO_CACHE_STORE, 'readonly');
        const req = tx.objectStore(VIDEO_CACHE_STORE).get(url);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('Video cache read failed', e);
      return null;
    }
  }

  async function putCachedVideo(url, blob, meta = {}) {
    const db = await openVideoCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VIDEO_CACHE_STORE, 'readwrite');
      tx.objectStore(VIDEO_CACHE_STORE).put({
        url,
        blob,
        size: blob.size,
        type: blob.type || meta.type || 'video/mp4',
        title: meta.title || '',
        savedAt: new Date().toISOString()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Could not save video cache.'));
    });
  }

  async function removeCachedVideo(url) {
    const db = await openVideoCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VIDEO_CACHE_STORE, 'readwrite');
      tx.objectStore(VIDEO_CACHE_STORE).delete(url);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Could not delete cached video.'));
    });
  }

  function humanSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  async function fetchVideoBlobWithProgress(url) {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`Video download failed: ${res.status}`);
    const type = res.headers.get('content-type') || 'video/mp4';
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader) {
      setStatus('Downloading video cache...');
      return await res.blob();
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total) setStatus(`Caching video ${Math.round(received / total * 100)}% • ${humanSize(received)} / ${humanSize(total)}`);
      else setStatus(`Caching video... ${humanSize(received)}`);
      await new Promise(r => setTimeout(r, 0));
    }
    return new Blob(chunks, { type });
  }

  async function cacheCurrentVideo() {
    const url = state.videoUrl && !String(state.videoUrl).startsWith('blob:') ? state.videoUrl : (localStorage.getItem('jm_video_url') || '');
    if (!isCacheableVideoUrl(url)) {
      toast('This video type cannot be cached. Use a direct MP4/WebM URL.');
      setStatus('Cache works best with direct MP4/WebM links, not YouTube, HLS/M3U8, or local blob links.');
      return;
    }
    try {
      const existing = await getCachedVideo(url);
      if (existing?.blob) {
        toast(`Already cached: ${humanSize(existing.size)}`);
        setStatus(`Cached video ready: ${humanSize(existing.size)}`);
        return;
      }
      if (!confirm('Download and save this video on this device for faster seeking? Large movies may need storage space.')) return;
      setStatus('Starting video cache download...');
      const blob = await fetchVideoBlobWithProgress(url);
      await putCachedVideo(url, blob, { title: document.title, type: blob.type });
      localStorage.setItem('jm_video_cache_url', url);
      toast('Video cached on this device');
      setStatus(`Cached video saved: ${humanSize(blob.size)}. Reopening and deep seeking should be faster.`);
      await loadUrl(url, { useCache: true, autoplay: false });
    } catch (e) {
      console.error(e);
      toast('Could not cache this video');
      setStatus('Video cache failed. The server may block CORS downloads, or device storage may be full.');
    }
  }

  async function cachedPlaybackUrl(originalUrl, opts = {}) {
    state.usingCachedVideo = false;
    if (!isCacheableVideoUrl(originalUrl)) return originalUrl;
    const cached = await getCachedVideo(originalUrl);
    if (!cached?.blob) {
      if (opts.forceCache) toast('No cached video found for this link');
      return originalUrl;
    }
    if (state.videoBlobUrl) {
      try { URL.revokeObjectURL(state.videoBlobUrl); } catch {}
      state.videoBlobUrl = '';
    }
    state.videoBlobUrl = URL.createObjectURL(cached.blob);
    state.usingCachedVideo = true;
    setStatus(`Using cached video • ${humanSize(cached.size)}`);
    return state.videoBlobUrl;
  }

  async function useCachedVideo() {
    const url = state.videoUrl || localStorage.getItem('jm_video_url') || localStorage.getItem('jm_video_cache_url') || '';
    if (!url) return toast('No video link found');
    await loadUrl(url, { useCache: true, forceCache: true, autoplay: false });
  }

  async function clearCurrentVideoCache() {
    const url = state.videoUrl || localStorage.getItem('jm_video_url') || localStorage.getItem('jm_video_cache_url') || '';
    if (!url) return toast('No cached video selected');
    try {
      await removeCachedVideo(url);
      localStorage.removeItem('jm_video_cache_url');
      if (state.videoBlobUrl) { try { URL.revokeObjectURL(state.videoBlobUrl); } catch {} state.videoBlobUrl = ''; }
      state.usingCachedVideo = false;
      toast('Video cache cleared');
      setStatus('Cached video removed from this device.');
    } catch (e) {
      console.error(e);
      toast('Could not clear cache');
    }
  }

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

  function subtitleTimeToMediaTime(time) {
    // syncLoop uses: subtitleTime = mediaTime - offset
    // so a click on subtitle time must seek to: subtitleTime + offset.
    return Math.max(0, (Number(time) || 0) + state.offset - 0.08);
  }

  function waitForEvent(target, names, timeout = 4500, predicate = null) {
    names = Array.isArray(names) ? names : [names];
    return new Promise(resolve => {
      let done = false;
      const cleanup = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        names.forEach(n => target.removeEventListener(n, onEvent));
        resolve(ok);
      };
      const onEvent = () => { if (!predicate || predicate()) cleanup(true); };
      names.forEach(n => target.addEventListener(n, onEvent, { passive: true }));
      const timer = setTimeout(() => cleanup(predicate ? !!predicate() : false), timeout);
      if (predicate && predicate()) cleanup(true);
    });
  }

  function getBufferedAhead(target) {
    const ranges = el.movie.buffered;
    for (let i = 0; i < ranges.length; i++) {
      if (target >= ranges.start(i) && target <= ranges.end(i)) return Math.max(0, ranges.end(i) - target);
    }
    return 0;
  }

  function canUseTimeFragment(url) {
    if (!url || url.startsWith('blob:') || /\.m3u8(?:[?#]|$)/i.test(url)) return false;
    return /^https?:/i.test(url) || /\.(mp4|webm|ogg)(?:[?#]|$)/i.test(url);
  }

  function urlWithTimeFragment(url, target) {
    const base = String(url || '').split('#')[0];
    return `${base}#t=${Math.max(0, target).toFixed(2)}`;
  }

  async function playMediaElement() {
    el.movie.playbackRate = state.speed;
    if (el.movie.paused) {
      try { await el.movie.play(); } catch (e) {
        // Mobile browsers may require one user gesture; the seek still happens, and the user can press play.
      }
    }
  }

  async function html5SmartSeek(target, play = true, opts = {}) {
    const token = Date.now() + Math.random();
    state.seekToken = token;
    state.isSeeking = true;
    state.seekGuardUntil = performance.now() + 1800;
    state.lastSeekTarget = target;
    setStatus(`Seeking ${formatTime(target)}...`);

    const finish = ok => {
      if (state.seekToken === token) {
        state.isSeeking = false;
        state.seekGuardUntil = performance.now() + 500;
        if (ok) setStatus(`Ready at ${formatTime(el.movie.currentTime || target)}`);
      }
      return ok;
    };

    try {
      if (!Number.isFinite(el.movie.duration) || el.movie.readyState < 1) {
        try { el.movie.load(); } catch {}
        await waitForEvent(el.movie, ['loadedmetadata','durationchange'], 6000, () => el.movie.readyState >= 1 || Number.isFinite(el.movie.duration));
      }

      el.movie.playbackRate = state.speed;
      try { el.movie.currentTime = target; } catch {}
      if (play) playMediaElement();

      let ok = await waitForEvent(el.movie, ['seeked','canplay','playing','timeupdate'], 5200, () => {
        const near = Math.abs((el.movie.currentTime || 0) - target) < 2.2;
        return near && (el.movie.readyState >= 2 || getBufferedAhead(target) > 0.5);
      });

      if (!ok && !state.usingCachedVideo && canUseTimeFragment(state.videoUrl)) {
        // Some MP4/CDN links freeze on deep seeks unless the browser starts the request with a media fragment.
        setStatus('Recovering stream near requested scene...');
        const src = urlWithTimeFragment(state.videoUrl, target);
        try { el.movie.pause(); } catch {}
        el.movie.src = src;
        try { el.movie.load(); } catch {}
        await waitForEvent(el.movie, ['loadedmetadata','durationchange'], 6500, () => el.movie.readyState >= 1 || Number.isFinite(el.movie.duration));
        try { if (Math.abs((el.movie.currentTime || 0) - target) > 3) el.movie.currentTime = target; } catch {}
        if (play) await playMediaElement();
        ok = await waitForEvent(el.movie, ['playing','canplay','timeupdate','seeked'], 6500, () => {
          const near = Math.abs((el.movie.currentTime || 0) - target) < 3.5 || (el.movie.currentTime || 0) > target - 4;
          return near && (el.movie.readyState >= 2 || !el.movie.paused);
        });
      }

      if (!ok) {
        setStatus('The video link is slow or does not support reliable seeking. Try MP4 with byte-range support or HLS/M3U8.');
        toast('Seek is stuck: use Recover video or a better direct MP4/HLS link');
      }
      return finish(ok);
    } catch (err) {
      console.warn('Smart seek failed', err);
      setStatus('Could not seek this video link reliably.');
      toast('Video seek failed');
      return finish(false);
    }
  }

  function seekMedia(time, play=true, opts = {}) {
    const target = subtitleTimeToMediaTime(time);
    state.lastSeekSubtitleTime = Number(time) || 0;
    if (state.playerType === 'html5') { html5SmartSeek(target, play, opts); }
    if (state.playerType === 'youtube' && state.yt?.seekTo) {
      state.seekGuardUntil = performance.now() + 900;
      state.lastSeekTarget = target;
      state.yt.seekTo(target, true);
      if (play) state.yt.playVideo();
      if (state.yt.setPlaybackRate) state.yt.setPlaybackRate(state.speed);
    }
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
    updateDockRepeatButtons();
  }

  function syncLoop() {
    if (state.playerType !== 'none' && state.subtitles.length) {
      const now = performance.now();
      const mediaTime = getMediaTime() - state.offset;

      if (state.isSeeking && now < state.seekGuardUntil) {
        state.syncTicker = requestAnimationFrame(syncLoop);
        return;
      }

      if (state.repeatStart >= 0 && state.repeatEnd >= 0 && now > state.repeatGuardUntil && !state.repeatWaiting) {
        const end = state.subtitles[state.repeatEnd]?.endTime ?? 0;
        if (mediaTime >= end) {
          beginRepeatDelay();
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
  function playMedia() { if (state.playerType === 'html5') el.movie.play().catch(()=>{}); if (state.playerType === 'youtube' && state.yt?.playVideo) state.yt.playVideo(); }

  function beginRepeatDelay() {
    if (state.repeatWaiting || state.repeatStart < 0 || state.repeatEnd < 0 || !state.subtitles[state.repeatStart]) return;
    const gapMs = Math.min(5, Math.max(1, Number(state.repeatDelaySeconds || 1))) * 1000;
    state.repeatWaiting = true;
    state.repeatGuardUntil = performance.now() + gapMs + 900;
    pauseMedia();
    setStatus(`Repeat pause ${state.repeatDelaySeconds}s...`);
    clearTimeout(state.repeatTimer);
    state.repeatTimer = setTimeout(() => {
      state.repeatWaiting = false;
      if (state.repeatStart >= 0 && state.repeatEnd >= 0 && state.subtitles[state.repeatStart]) {
        seekMedia(state.subtitles[state.repeatStart].startTime, true);
        state.repeatGuardUntil = performance.now() + 900;
      }
    }, gapMs);
  }

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

  function repeatLabel(i) {
    if (state.repeatStart < 0 || state.repeatEnd < 0) return 'Repeat';
    if (i < state.repeatStart || i > state.repeatEnd) return i < state.repeatStart ? 'Extend ↑' : 'Extend ↓';
    if (state.repeatStart === state.repeatEnd) return 'Stop loop';
    if (i === state.repeatStart) return 'Loop start';
    if (i === state.repeatEnd) return 'Loop end';
    return 'In loop';
  }

  function cardHtml(i, item) {
    const active = i === state.lastIndex ? ' active' : '';
    const repeatOn = state.repeatStart >= 0 && i >= state.repeatStart && i <= state.repeatEnd;
    return `<article id="card-${i}" class="subtitle-card${active}" data-index="${i}">
      <div class="card-en">${wordHtml(item.en, i === state.lastIndex ? state.lastWordIndex : -1)}</div>
      <div id="ar-${i}" class="card-ar">${item.ar || ''}</div>
      <div class="card-actions">
        <button type="button" class="play-btn" data-play="${i}">العب <span class="time-chip">${item.time}</span></button>
        <button type="button" class="repeat-btn${repeatOn ? ' active' : ''}" data-repeat="${i}">${repeatLabel(i)}</button>
      </div>
      <div class="line-action-strip" aria-label="Line actions">
        <button type="button" class="action-icon copy" data-line-action="copy" data-index="${i}" aria-label="Copy line" title="Copy line">📋</button>
        <button type="button" class="action-icon translate" data-line-action="translate" data-index="${i}" aria-label="Translate line naturally with Lara" title="Translate naturally with Lara">🌐</button>
        <button type="button" class="action-icon save" data-line-action="save" data-index="${i}" aria-label="Save line" title="Save line">★</button>
        <button type="button" class="action-icon phrase" data-line-action="phrases" data-index="${i}" aria-label="Save phrase chunks" title="Save phrase chunks">🧩</button>
        <button type="button" class="action-icon template" data-line-action="template" data-index="${i}" aria-label="Save sentence template" title="Save sentence template">🧱</button>
        <button type="button" class="action-icon playphrase" data-line-action="playphrase" data-index="${i}" aria-label="Search in PlayPhrase" title="Search in PlayPhrase">▶</button>
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

  function currentSubtitleIndex() {
    return state.lastIndex >= 0 ? state.lastIndex : (state.activeIndex >= 0 ? state.activeIndex : -1);
  }

  function updateDockRepeatButtons() {
    const one = $('loopCurrentBtn'), start = $('loopStartBtn'), end = $('loopEndBtn'), off = $('loopOffBtn');
    if (!one || !start || !end || !off) return;
    const i = currentSubtitleIndex();
    const inLoop = state.repeatStart >= 0 && state.repeatEnd >= 0 && i >= state.repeatStart && i <= state.repeatEnd;
    one.classList.toggle('active', state.repeatStart === i && state.repeatEnd === i);
    start.classList.toggle('active', state.repeatStart === i);
    end.classList.toggle('active', state.repeatEnd === i && state.repeatStart !== state.repeatEnd);
    off.classList.toggle('active', state.repeatStart >= 0);
    one.textContent = inLoop ? '⟲ Looping' : '⟲ One';
  }

  function setRepeatRange(start, end, playFromStart = true) {
    if (!state.subtitles.length) return;
    start = Math.max(0, Math.min(Number(start), state.subtitles.length - 1));
    end = Math.max(0, Math.min(Number(end), state.subtitles.length - 1));
    state.repeatStart = Math.min(start, end);
    state.repeatEnd = Math.max(start, end);
    state.repeatWaiting = false;
    clearTimeout(state.repeatTimer);
    state.repeatGuardUntil = performance.now() + 300;
    renderList(currentSubtitleIndex() >= 0 ? currentSubtitleIndex() : state.repeatStart);
    updateDockRepeatButtons();
    if (playFromStart) seekMedia(state.subtitles[state.repeatStart].startTime, true);
    toast(state.repeatStart === state.repeatEnd ? 'Repeating current subtitle' : `Looping ${state.repeatEnd - state.repeatStart + 1} subtitles`);
    debounceSave();
  }

  function repeatCurrentSubtitle() {
    const i = currentSubtitleIndex();
    if (i < 0) return toast('No active subtitle yet');
    setRepeatRange(i, i, true);
    jumpToCard(i);
  }

  function setLoopStartFromCurrent() {
    const i = currentSubtitleIndex();
    if (i < 0) return toast('No active subtitle yet');
    if (state.repeatEnd >= 0) setRepeatRange(i, state.repeatEnd, true);
    else setRepeatRange(i, i, true);
    toast('Loop start set. Go to another subtitle and tap B End.');
    jumpToCard(i);
  }

  function setLoopEndFromCurrent() {
    const i = currentSubtitleIndex();
    if (i < 0) return toast('No active subtitle yet');
    const start = state.repeatStart >= 0 ? state.repeatStart : i;
    setRepeatRange(start, i, true);
    jumpToCard(i);
  }

  function stopRepeat() {
    state.repeatStart = -1;
    state.repeatEnd = -1;
    state.repeatWaiting = false;
    clearTimeout(state.repeatTimer);
    updateDockRepeatButtons();
    renderList(currentSubtitleIndex() >= 0 ? currentSubtitleIndex() : state.listCenter);
    toast('Repeat off');
    debounceSave();
  }

  function hideLineActionMenus() {
    document.querySelectorAll('.line-action-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
    document.querySelectorAll('.menu-trigger.active').forEach(b => b.classList.remove('active'));
  }

  function toggleLineActionMenu(index, btn) {
    const menu = document.querySelector(`[data-action-menu-for="${index}"]`);
    if (!menu) return;
    const willOpen = menu.classList.contains('hidden');
    hideLineActionMenus();
    if (willOpen) {
      menu.classList.remove('hidden');
      btn?.classList.add('active');
      requestAnimationFrame(() => menu.scrollIntoView({behavior:'smooth', block:'nearest'}));
    }
  }

  async function translateMyMemory(text) {
    const res = await fetch('/api/mymemory-translate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text, source:'en', target:'ar' }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.translatedText || '';
  }

  const LARA_SETTINGS_CLOUD_WORD = '__lara_settings__';

  function getLaraConfig() {
    return {
      accessKeyId: String(localStorage.getItem('jm_lara_access_key_id') || '').trim(),
      accessKeySecret: String(localStorage.getItem('jm_lara_access_key_secret') || '').trim()
    };
  }

  function saveLaraConfigToLocal() {
    const accessKeyId = String($('laraKeyIdInput')?.value || '').trim();
    const accessKeySecret = String($('laraSecretInput')?.value || '').trim();
    if (accessKeyId) localStorage.setItem('jm_lara_access_key_id', accessKeyId); else localStorage.removeItem('jm_lara_access_key_id');
    if (accessKeySecret) localStorage.setItem('jm_lara_access_key_secret', accessKeySecret); else localStorage.removeItem('jm_lara_access_key_secret');
    return { accessKeyId, accessKeySecret };
  }

  function isLaraSettingsCloudItem(item) {
    const key = String(item?.key || '').toLowerCase();
    const word = String(item?.word || '').toLowerCase();
    return key === 'setting:lara' || word === LARA_SETTINGS_CLOUD_WORD;
  }

  function makeLaraSettingsCloudItem() {
    const cfg = getLaraConfig();
    if (!cfg.accessKeyId || !cfg.accessKeySecret) return null;
    const now = new Date().toISOString();
    return {
      kind: 'setting',
      hidden: true,
      key: 'setting:lara',
      word: LARA_SETTINGS_CLOUD_WORD,
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      savedAt: now,
      updatedAt: now
    };
  }

  function applyLaraSettingsFromCloud(remoteWords = []) {
    const item = (remoteWords || []).find(isLaraSettingsCloudItem);
    if (!item) return false;
    const accessKeyId = String(item.accessKeyId || '').trim();
    const accessKeySecret = String(item.accessKeySecret || '').trim();
    if (!accessKeyId || !accessKeySecret) return false;
    localStorage.setItem('jm_lara_access_key_id', accessKeyId);
    localStorage.setItem('jm_lara_access_key_secret', accessKeySecret);
    return true;
  }

  function savedWordsForCloud() {
    const visibleWords = state.savedWords
      .filter(x => !isLaraSettingsCloudItem(x))
      .map(normalizeSavedWord)
      .filter(x => x.word && !isLaraSettingsCloudItem(x));
    const laraSettings = makeLaraSettingsCloudItem();
    return laraSettings ? [...visibleWords, laraSettings] : visibleWords;
  }

  async function saveLaraSettingsToCloud({ silent = false } = {}) {
    const cfg = getLaraConfig();
    if (!cfg.accessKeyId || !cfg.accessKeySecret) {
      if (!silent) toast('Enter Lara keys first');
      return false;
    }
    return await syncSavedItemsToCloud({ silent, reason: 'lara-settings' });
  }

  function laraApiErrorMessage(status, data) {
    if (status === 404) return 'Lara API proxy is missing. Upload the full Vercel project folder, not the HTML file only.';
    if (status === 401 || status === 403) return 'Lara rejected the credentials. Check Access Key ID and Secret.';
    return data?.error || data?.details || `Lara failed (${status})`;
  }

  function getLaraPayload(extra = {}) {
    const cfg = getLaraConfig();
    const payload = {
      source: 'en-US',
      target: 'ar',
      style: 'fluid',
      instructions: [
        'Translate movie and series subtitle dialogue into natural Arabic.',
        'Keep the translation concise and suitable for subtitles.',
        'Preserve names, jokes, emotion, slang, tone, and implied meaning.',
        'Do not add explanations, notes, or quotation marks.'
      ],
      ...extra
    };
    if (cfg.accessKeyId && cfg.accessKeySecret) payload.credentials = cfg;
    return payload;
  }

  function openLaraSettings(message = '') {
    openMenu(false);
    const cfg = getLaraConfig();
    if ($('laraKeyIdInput')) $('laraKeyIdInput').value = cfg.accessKeyId;
    if ($('laraSecretInput')) $('laraSecretInput').value = cfg.accessKeySecret;
    if ($('laraSettingsStatus')) $('laraSettingsStatus').textContent = message || 'Add credentials here, or use Vercel environment variables.';
    openModal('laraModal');
  }

  async function translateLara(text) {
    const res = await fetch('/api/lara-translate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(getLaraPayload({ text }))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(laraApiErrorMessage(res.status, data));
    return data.translatedText || '';
  }

  async function translateLaraItems(items) {
    const res = await fetch('/api/lara-translate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(getLaraPayload({ items }))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(laraApiErrorMessage(res.status, data));
    return data.translated || [];
  }

  async function translateLine(idx) {
    const item = state.subtitles[idx]; if (!item) return;
    setStatus('Translating line naturally with Lara...');
    try {
      item.ar = await translateLara(cleanLine(item.en));
      $('ar-' + idx) && ($('ar-' + idx).innerHTML = escapeHtml(item.ar));
      if (idx === state.lastIndex) updateDock(item, state.lastWordIndex);
      debounceSave(); scheduleCloudLibrarySync(); toast('Lara translation done');
    } catch (e) {
      console.warn(e);
      toast('Lara needs setup');
      openLaraSettings(e.message || 'Lara credentials required.');
    }
  }

  async function translateAllLara() {
    const jobs = state.subtitles.map((it, index) => ({ index, text: cleanLine(it.en) })).filter(x => x.text && !state.subtitles[x.index].ar);
    if (!jobs.length) return toast('Nothing to translate');
    openMenu(false); setStatus(`Lara translating ${jobs.length} lines naturally...`);
    const chunkSize = 24;
    let done = 0;
    for (let i=0; i<jobs.length; i+=chunkSize) {
      const items = jobs.slice(i, i+chunkSize);
      try {
        const rows = await translateLaraItems(items);
        for (const row of rows) {
          if (state.subtitles[row.index]) {
            state.subtitles[row.index].ar = row.ar || '';
            done++;
          }
        }
        setStatus(`Lara translated ${done}/${jobs.length}`);
        renderList(state.listCenter); debounceSave(); scheduleCloudLibrarySync();
      } catch (e) {
        console.warn(e);
        toast('Lara needs setup');
        openLaraSettings(e.message || 'Lara credentials required.');
        break;
      }
      await new Promise(r => setTimeout(r, 650));
    }
    saveState(); setStatus('Lara translation finished'); toast('Natural translation finished');
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
  function saveWord(word, ar='', extra = {}) {
    word = String(word || '').trim();
    if (!word) return;
    const key = word.toLowerCase();
    const normalizedPayload = normalizeSavedWord({ word, ar, savedAt: new Date().toISOString(), ...extra });
    const existing = state.savedWords.find(x => String(x.word || '').toLowerCase() === key);
    if (existing) {
      existing.ar = existing.ar || normalizedPayload.ar || '';
      existing.kind = normalizedPayload.kind;
      existing.contextEn = existing.contextEn || normalizedPayload.contextEn || '';
      existing.contextAr = existing.contextAr || normalizedPayload.contextAr || '';
      if ((!existing.examples || !existing.examples.length) && normalizedPayload.examples?.length) existing.examples = normalizedPayload.examples;
      existing.sourceLineKey = existing.sourceLineKey || normalizedPayload.sourceLineKey || '';
      existing.startTime = existing.startTime || normalizedPayload.startTime || 0;
      Object.assign(existing, normalizeSavedWord(existing));
      toast(normalizedPayload.kind === 'template' ? 'Template already saved' : (normalizedPayload.kind === 'phrase' ? 'Phrase already saved' : 'Word already saved'));
    } else {
      state.savedWords.unshift(normalizedPayload);
      toast(normalizedPayload.kind === 'template' ? 'Template saved' : (normalizedPayload.kind === 'phrase' ? 'Phrase saved' : 'Word saved'));
    }
    writeJSON('jm_saved_words', state.savedWords.map(normalizeSavedWord));
    debounceSave();
    scheduleCloudLibrarySync();
  }

  async function savePhraseFromSubtitle(phrase, idx = state.lastIndex) {
    phrase = String(phrase || '').trim().toLowerCase();
    const item = state.subtitles[idx];
    if (!phrase || !item) return;
    setStatus(`Saving phrase: ${phrase}`);
    const contextEn = cleanLine(item.en);
    const contextAr = item.ar || '';
    const ar = await translatePhraseInContext(phrase, contextEn);
    saveWord(phrase, ar, { kind: 'phrase', contextEn, contextAr, sourceLineKey: lineKey(item), startTime: item.startTime || 0 });
    setStatus('Phrase saved for smart review');
  }

  async function saveDetectedPhrasesFromLine(idx) {
    const item = state.subtitles[idx];
    if (!item) return;
    const phrases = detectPhrasesInLine(item.en);
    if (!phrases.length) return toast('No phrase chunks found in this line');
    let saved = 0;
    for (const p of phrases.slice(0, 6)) {
      await savePhraseFromSubtitle(p.phrase, idx);
      saved++;
    }
    toast(`${saved} phrase${saved === 1 ? '' : 's'} saved`);
  }

  async function saveTemplateFromSubtitle(idx = state.lastIndex) {
    const item = state.subtitles[idx];
    if (!item) return;
    const template = extractTemplateFromLine(item.en);
    if (!template || !template.pattern) return toast('No useful template found in this line');
    setStatus('Saving sentence template...');
    const contextEn = cleanLine(item.en);
    const contextAr = item.ar || '';
    const ar = await translateTemplateMeaning(template, contextEn);
    saveWord(template.pattern, ar || template.usageAr || '', {
      kind: 'template',
      contextEn,
      contextAr,
      sourceLineKey: lineKey(item),
      startTime: item.startTime || 0,
      templateSlot: template.slot || '',
      templateUsageEn: template.usageEn || '',
      templateUsageAr: template.usageAr || '',
      templateRule: template.rule || template.name || '',
      examples: template.examples || []
    });
    setStatus('Template saved for smart review');
  }

  async function saveTemplatesFromAllSubtitles() {
    if (!state.subtitles.length) return toast('Upload subtitles first');
    openMenu(false);
    let saved = 0;
    const seen = new Set(state.savedWords.filter(x => x.kind === 'template').map(x => String(x.word || '').toLowerCase()));
    for (let i = 0; i < state.subtitles.length; i++) {
      const template = extractTemplateFromLine(state.subtitles[i].en);
      if (!template?.pattern) continue;
      const key = template.pattern.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const item = state.subtitles[i];
      const ar = await translateTemplateMeaning(template, cleanLine(item.en));
      state.savedWords.unshift(normalizeSavedWord({
        kind: 'template',
        word: template.pattern,
        ar: ar || template.usageAr || '',
        contextEn: cleanLine(item.en),
        contextAr: item.ar || '',
        sourceLineKey: lineKey(item),
        startTime: item.startTime || 0,
        templateSlot: template.slot || '',
        templateUsageEn: template.usageEn || '',
        templateUsageAr: template.usageAr || '',
        templateRule: template.rule || template.name || '',
        examples: template.examples || [],
        savedAt: new Date().toISOString()
      }));
      saved++;
      if (saved % 5 === 0) { writeJSON('jm_saved_words', state.savedWords.map(normalizeSavedWord)); debounceSave(); scheduleCloudLibrarySync(); setStatus(`Saved ${saved} templates...`); }
      if (saved >= 40) break;
    }
    writeJSON('jm_saved_words', state.savedWords.map(normalizeSavedWord)); debounceSave(); scheduleCloudLibrarySync();
    toast(saved ? `${saved} templates saved` : 'No new templates found');
    setStatus(saved ? `${saved} sentence templates saved to cloud sync queue` : 'No new templates found');
  }

  async function saveLine(idx, translateIfMissing = true) {
    const item = state.subtitles[idx]; if (!item) return;
    const key = lineKey(item);
    let ar = item.ar || '';
    if (!ar && translateIfMissing) {
      setStatus('Translating line with Lara before saving...');
      try { ar = await translateLara(cleanLine(item.en)); item.ar = ar; if ($('ar-' + idx)) $('ar-' + idx).innerHTML = escapeHtml(ar); if (idx === state.lastIndex) updateDock(item, state.lastWordIndex); } catch (e) { console.warn(e); ar = ''; openLaraSettings(e.message || 'Lara credentials required.'); }
    }
    const existing = state.savedLines.find(x => x.key === key);
    if (existing) { existing.ar = existing.ar || ar; toast('Line already saved'); }
    else state.savedLines.unshift(normalizeSavedLine({...item, ar, key, savedAt:new Date().toISOString()}));
    writeJSON('jm_saved_lines', state.savedLines); debounceSave(); toast('Line saved'); scheduleCloudLibrarySync();
  }
  async function copyLine(idx) {
    const item = state.subtitles[idx]; if (!item) return;
    const text = cleanLine(item.en);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('Clipboard API unavailable');
      toast('Copied');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch { toast('Copy failed'); }
      ta.remove();
    }
  }

  async function openDict(word, idx = state.lastIndex) {
    word = String(word || '').replace(/[^A-Za-zÀ-ÿ0-9'-]/g, '').trim();
    if (!word) return;
    const item = state.subtitles[idx];
    const contextEn = item ? cleanLine(item.en) : '';
    state.currentDictWord = word;
    state.currentDictExamples = [];
    $('dictWord').textContent = word;
    $('dictTranslation').textContent = 'Searching...';
    $('dictContext').innerHTML = idx >= 0 && item ? wordHtml(item.en, -1) : '';
    if ($('dictPhrases')) {
      const phrases = item ? detectPhrasesInLine(item.en, word) : [];
      $('dictPhrases').innerHTML = phrases.length ? `<div class="phrase-suggestions"><b>🧩 Phrases in this line</b><p>Save the full chunk with its movie-context meaning.</p>${phrases.map(p => `<button class="phrase-save-btn" data-save-phrase="${escapeHtml(p.phrase)}" data-index="${idx}">★ ${escapeHtml(p.phrase)}</button>`).join('')}</div>` : '';
    }
    $('dictExamples').innerHTML = '';
    openModal('dictModal');
    speak(word);
    $('dictPlayPhraseBtn').onclick = () => openPlayPhrase(word);
    $('dictSaveBtn').onclick = () => saveWord(word, $('dictTranslation').textContent || '', { kind: 'word', contextEn, contextAr: item?.ar || '', sourceLineKey: item ? lineKey(item) : '', startTime: item?.startTime || 0, examples: state.currentDictExamples || [] });
    $('dictSpeakBtn').onclick = () => speak(word);
    try { $('dictTranslation').textContent = await translateMyMemory(word); } catch { $('dictTranslation').textContent = 'Translation failed'; }
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const data = await res.json(); const examples = [];
      for (const m of data?.[0]?.meanings || []) for (const d of m.definitions || []) if (d.example) examples.push(d.example);
      const topExamples = [...new Set(examples)].slice(0,3);
      if (!topExamples.length) throw new Error('No examples');
      $('dictExamples').innerHTML = '<div class="example">Translating examples...</div>';
      const rows = [];
      state.currentDictExamples = [];
      for (const ex of topExamples) {
        let ar = '';
        try { ar = await translateMyMemory(ex); } catch {}
        state.currentDictExamples.push({ en: ex, ar: ar || '' });
        rows.push(`<div class="example"><p class="ex-en" dir="ltr">${escapeHtml(ex)}</p><p class="ex-ar" dir="rtl">${escapeHtml(ar || 'تعذر ترجمة المثال')}</p></div>`);
      }
      $('dictExamples').innerHTML = rows.join('');
    } catch { $('dictExamples').innerHTML = '<div class="example">No examples found.</div>'; }
  }

  function showSaved(type) {
    const body = $('savedBody');
    const isWords = type === 'words';
    const isPhrases = type === 'phrases';
    const isTemplates = type === 'templates';
    $('savedTitle').textContent = isTemplates ? 'Saved templates' : (isPhrases ? 'Saved phrases' : (isWords ? 'Saved words' : 'Saved lines'));
    state.savedWords = state.savedWords.map(normalizeSavedWord).filter(x => x.word);
    state.savedLines = state.savedLines.map(normalizeSavedLine);
    const wordItems = isTemplates ? state.savedWords.filter(x => x.kind === 'template') : (isPhrases ? state.savedWords.filter(x => x.kind === 'phrase') : state.savedWords.filter(x => x.kind === 'word'));
    const arr = (isWords || isPhrases || isTemplates) ? wordItems : state.savedLines;
    const countLabel = isTemplates ? 'templates' : (isPhrases ? 'phrases' : (isWords ? 'words' : 'lines'));
    const header = `<div class="saved-folder-head"><b>${arr.length} saved ${countLabel}</b><small>Tap any title to open meaning, context, examples, and review options.</small></div>`;
    if (!arr.length) { body.innerHTML = header + '<p>No saved items yet.</p>'; openModal('savedModal'); return; }
    body.innerHTML = header + arr.map((x, i) => {
      if (isWords || isPhrases || isTemplates) {
        const originalIndex = state.savedWords.indexOf(x);
        const examples = Array.isArray(x.examples) && x.examples.length ? `<div class="saved-section"><b>Examples</b>${x.examples.slice(0,3).map(ex => `<div class="saved-example"><p dir="ltr">${escapeHtml(ex.en || ex)}</p>${ex.ar ? `<p dir="rtl">${escapeHtml(ex.ar)}</p>` : ''}</div>`).join('')}</div>` : '';
        const usage = x.kind === 'template' ? `<div class="saved-section template-usage"><b>When to use it</b>${x.templateUsageEn ? `<p dir="ltr">${escapeHtml(x.templateUsageEn)}</p>` : ''}${x.templateUsageAr ? `<p dir="rtl" class="ar">${escapeHtml(x.templateUsageAr)}</p>` : ''}${x.templateSlot ? `<small>Original slot: ${escapeHtml(x.templateSlot)}</small>` : ''}</div>` : '';
        const label = x.kind === 'template' ? 'Template' : (x.kind === 'phrase' ? 'Phrase' : 'Word');
        return `<details class="saved-details ${x.kind === 'phrase' ? 'phrase-item' : ''} ${x.kind === 'template' ? 'template-item' : ''}">
          <summary><span class="saved-type-chip ${x.kind === 'template' ? 'template-chip' : ''}">${label}</span><b dir="ltr">${escapeHtml(x.word)}</b><span class="due-chip">Due: ${formatDue(x.dueAt)}</span></summary>
          <div class="saved-detail-body">
            ${x.ar ? `<div class="saved-section"><b>Meaning / usage</b><p dir="rtl">${escapeHtml(x.ar)}</p></div>` : ''}
            ${usage}
            ${x.contextEn ? `<div class="saved-section"><b>Movie context</b><p dir="ltr">${escapeHtml(x.contextEn)}</p>${x.contextAr ? `<p dir="rtl" class="ar">${escapeHtml(x.contextAr)}</p>` : ''}</div>` : ''}
            ${examples}
            <div class="saved-actions"><button class="small-btn" data-pp-word="${escapeHtml(x.word)}">PlayPhrase</button><button class="small-btn" data-review-one="word:${originalIndex}">Review</button></div>
          </div>
        </details>`;
      }
      return `<details class="saved-details">
        <summary><b dir="ltr">${escapeHtml(cleanLine(x.en))}</b><span class="due-chip">Due: ${formatDue(x.dueAt)}</span></summary>
        <div class="saved-detail-body">
          ${x.ar ? `<div class="saved-section"><b>Arabic translation</b><p dir="rtl">${escapeHtml(x.ar)}</p></div>` : ''}
          <div class="saved-actions"><button class="small-btn" data-saved-play="${i}">Play</button><button class="small-btn" data-pp-line="${i}">PlayPhrase</button><button class="small-btn" data-review-one="line:${i}">Review</button></div>
        </div>
      </details>`;
    }).join('');
    openModal('savedModal');
  }

  function formatDue(iso) {
    const d = new Date(iso || Date.now()); const diff = d.getTime() - Date.now();
    if (diff <= 0) return 'now';
    const mins = Math.ceil(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.ceil(mins/60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.ceil(hrs/24)}d`;
  }

  function getDueReviewCards() {
    state.savedLines = state.savedLines.map(normalizeSavedLine);
    state.savedWords = state.savedWords.map(normalizeSavedWord).filter(x => x.word);
    const now = Date.now();
    const lineCards = state.savedLines
      .filter(x => new Date(x.dueAt || 0).getTime() <= now)
      .map(x => ({ type: 'line', key: x.key, item: x }));
    const wordCards = state.savedWords
      .filter(x => new Date(x.dueAt || 0).getTime() <= now)
      .map(x => ({ type: 'word', key: x.key || wordKey(x.word), item: x }));
    return [...wordCards, ...lineCards].sort((a, b) => new Date(a.item.dueAt || 0) - new Date(b.item.dueAt || 0));
  }

  function allReviewItems() {
    return [
      ...state.savedWords.map(normalizeSavedWord).filter(x => x.word).map(x => ({ type:'word', key:x.key || wordKey(x.word), item:x })),
      ...state.savedLines.map(normalizeSavedLine).map(x => ({ type:'line', key:x.key, item:x }))
    ];
  }

  function showReviewCards() {
    openMenu(false);
    state.reviewQueue = getDueReviewCards();
    state.reviewIndex = 0;
    state.reviewRevealed = false;
    $('savedTitle').textContent = 'Smart review cards';
    renderReviewCard();
    openModal('savedModal');
  }

  function showSingleReviewCard(type, index) {
    const item = type === 'word' ? state.savedWords[Number(index)] : state.savedLines[Number(index)];
    if (!item) return;
    state.reviewQueue = [{ type, key: type === 'word' ? (item.key || wordKey(item.word)) : item.key, item: type === 'word' ? normalizeSavedWord(item) : normalizeSavedLine(item) }];
    state.reviewIndex = 0;
    state.reviewRevealed = false;
    $('savedTitle').textContent = type === 'word' ? 'Review word' : 'Review line';
    renderReviewCard();
    openModal('savedModal');
  }

  function renderReviewCard() {
    const body = $('savedBody');
    const due = state.reviewQueue;
    if (!state.savedLines.length && !state.savedWords.length) { body.innerHTML = '<p>No saved words or lines yet.</p>'; return; }
    if (!due.length) {
      const all = allReviewItems().sort((a,b)=>new Date(a.item.dueAt)-new Date(b.item.dueAt));
      const next = all[0]?.item;
      body.innerHTML = `<div class="review-empty"><b>All cards reviewed ✅</b><p>Next review: ${formatDue(next?.dueAt)}</p><button class="small-btn" data-show-saved-lines>Open saved lines</button></div>`;
      return;
    }
    const card = due[state.reviewIndex] || due[0];
    const item = card.item;
    const isWord = card.type === 'word';
    const front = isWord ? item.word : cleanLine(item.en);
    const back = item.ar || (isWord ? 'لا توجد ترجمة محفوظة لهذه الكلمة أو العبارة' : 'لا توجد ترجمة محفوظة');
    const badge = isWord ? (item.kind === 'template' ? 'Template card' : (item.kind === 'phrase' ? 'Phrase card' : 'Word card')) : 'Line card';
    const reviewContext = isWord ? `${item.templateUsageEn ? `<div class="review-context" dir="ltr">${escapeHtml(item.templateUsageEn)}</div>` : ''}${item.templateUsageAr ? `<div class="review-context ar" dir="rtl">${escapeHtml(item.templateUsageAr)}</div>` : ''}${item.contextEn ? `<div class="review-context" dir="ltr">${escapeHtml(item.contextEn)}</div>` : ''}${item.contextAr ? `<div class="review-context ar" dir="rtl">${escapeHtml(item.contextAr)}</div>` : ''}` : '';
    body.innerHTML = `<div class="review-card" data-review-key="${escapeHtml(card.key)}" data-review-type="${card.type}">
      <div class="review-count">${state.reviewIndex + 1} / ${due.length} due • ${badge}</div>
      <div class="review-front" dir="ltr">${escapeHtml(front)}</div>
      <div class="review-back ${state.reviewRevealed ? '' : 'hidden'}" dir="rtl">${escapeHtml(back)}${reviewContext}</div>
      <div class="review-actions">
        <button class="small-btn" data-review-reveal>Show meaning</button>
        <button class="small-btn again" data-review-grade="again">Again</button>
        <button class="small-btn hard" data-review-grade="hard">Hard</button>
        <button class="small-btn good" data-review-grade="good">Good</button>
        <button class="small-btn easy" data-review-grade="easy">Easy</button>
      </div>
    </div>`;
  }

  function applyReviewGrade(item, grade) {
    const now = new Date();
    item.reviewCount = Number(item.reviewCount || 0) + 1;
    item.lastReviewedAt = now.toISOString();
    let interval = Number(item.intervalDays || 0);
    let ease = Number(item.ease || 2.5);
    if (grade === 'again') { interval = 0; ease = Math.max(1.3, ease - .25); item.dueAt = new Date(now.getTime() + 10*60000).toISOString(); }
    else {
      if (grade === 'hard') { interval = interval ? Math.max(1, Math.round(interval * 1.2)) : 1; ease = Math.max(1.3, ease - .15); }
      if (grade === 'good') { interval = interval ? Math.round(interval * ease) : 1; }
      if (grade === 'easy') { interval = interval ? Math.round(interval * (ease + .8)) : 3; ease += .15; }
      item.intervalDays = interval; item.ease = ease; item.dueAt = new Date(now.getTime() + interval*86400000).toISOString();
    }
  }

  function gradeReview(key, grade, type = '') {
    let item = null;
    if (type === 'word' || String(key).startsWith('word:')) item = state.savedWords.find(x => (x.key || wordKey(x.word)) === key);
    else item = state.savedLines.find(x => x.key === key);
    if (!item) return;
    applyReviewGrade(item, grade);
    state.savedWords = state.savedWords.map(normalizeSavedWord).filter(x => x.word);
    state.savedLines = state.savedLines.map(normalizeSavedLine);
    writeJSON('jm_saved_words', state.savedWords); writeJSON('jm_saved_lines', state.savedLines); scheduleCloudLibrarySync();
    state.reviewQueue = getDueReviewCards(); state.reviewIndex = 0; state.reviewRevealed = false; renderReviewCard();
  }


  async function getCloudClient() {
    if (!CLOUD_CONFIG.url || !CLOUD_CONFIG.key || !CLOUD_CONFIG.userCode) throw new Error('Cloud config is missing.');
    if (!window.supabase?.createClient) await loadScript(SUPABASE_CDN);
    if (!state.cloudClient) state.cloudClient = window.supabase.createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.key);
    return state.cloudClient;
  }

  function scheduleCloudLibrarySync() {
    clearTimeout(state.cloudSyncTimer);
    state.cloudSyncTimer = setTimeout(() => syncSavedItemsToCloud({ silent: true, reason: 'auto' }), 900);
  }

  async function syncSavedItemsToCloud({ silent = true, reason = 'manual' } = {}) {
    if (state.cloudSyncInProgress) {
      state.cloudSyncPending = true;
      return false;
    }
    state.cloudSyncInProgress = true;
    try {
      normalizeLibraryState();
      const sb = await getCloudClient();
      const payload = {
        user_code: CLOUD_CONFIG.userCode,
        saved_phrases: state.savedLines.map(normalizeSavedLine),
        saved_words: savedWordsForCloud(),
        updated_at: new Date().toISOString()
      };
      const { error } = await sb.from('user_library').upsert(payload, { onConflict: 'user_code' });
      if (error) throw error;
      state.cloudLastSyncAt = payload.updated_at;
      localStorage.setItem('jm_cloud_last_sync_at', state.cloudLastSyncAt);
      if (!silent) {
        setStatus(`Saved items synced to Supabase • ${state.savedWords.length} words/phrases/templates • ${state.savedLines.length} lines`);
        toast('Saved items synced to cloud');
      } else if (reason === 'auto') {
        setStatus(`Auto-synced saved items • ${state.savedWords.length + state.savedLines.length} cards`);
      }
      return true;
    } catch (e) {
      console.warn('Cloud sync failed:', e);
      if (!silent) {
        toast('Cloud sync failed');
        alert('Cloud sync failed: ' + (e.message || e));
      }
      return false;
    } finally {
      state.cloudSyncInProgress = false;
      if (state.cloudSyncPending) {
        state.cloudSyncPending = false;
        scheduleCloudLibrarySync();
      }
    }
  }

  async function loadSavedItemsFromCloud({ silent = true, merge = true } = {}) {
    try {
      const sb = await getCloudClient();
      const { data, error } = await sb.from('user_library').select('saved_phrases,saved_words,updated_at').eq('user_code', CLOUD_CONFIG.userCode).maybeSingle();
      if (error) throw error;
      if (data) {
        const remoteLines = Array.isArray(data.saved_phrases) ? data.saved_phrases : [];
        const remoteWordsRaw = Array.isArray(data.saved_words) ? data.saved_words : [];
        const restoredLara = applyLaraSettingsFromCloud(remoteWordsRaw);
        const remoteWords = remoteWordsRaw.filter(x => !isLaraSettingsCloudItem(x));
        if (merge) {
          state.savedLines = mergeByKey(state.savedLines, remoteLines, savedLineMergeKey, normalizeSavedLine);
          state.savedWords = mergeByKey(state.savedWords, remoteWords, savedWordMergeKey, normalizeSavedWord).filter(x => x.word && !isLaraSettingsCloudItem(x));
        } else {
          state.savedLines = remoteLines.map(normalizeSavedLine);
          state.savedWords = remoteWords.map(normalizeSavedWord).filter(x => x.word && !isLaraSettingsCloudItem(x));
        }
        if (restoredLara && $('laraSettingsStatus')) $('laraSettingsStatus').textContent = 'Lara settings restored from cloud.';
        writeJSON('jm_saved_lines', state.savedLines);
        writeJSON('jm_saved_words', state.savedWords);
        saveState();
        state.cloudLastSyncAt = data.updated_at || new Date().toISOString();
        localStorage.setItem('jm_cloud_last_sync_at', state.cloudLastSyncAt);
        if (!silent) {
          setStatus(`Loaded saved items from Supabase • ${state.savedWords.length} words/phrases/templates • ${state.savedLines.length} lines`);
          toast('Saved items loaded from cloud');
        }
        return true;
      }
      if (!silent) toast('No saved items in cloud yet');
      return false;
    } catch (e) {
      console.warn('Cloud load failed:', e);
      if (!silent) {
        toast('Cloud load failed');
        alert('Cloud load failed: ' + (e.message || e));
      }
      return false;
    }
  }

  // Backward-compatible names used elsewhere in the app.
  const upsertCloudUserLibrary = (silent = true) => syncSavedItemsToCloud({ silent, reason: 'compat' });
  const loadCloudUserLibrary = () => loadSavedItemsFromCloud({ silent: true, merge: true });

  function buildCurrentSrtText() {
    return state.subtitles.map((item, i) => `${i + 1}\n${secondsToSrtTime(item.startTime)} --> ${secondsToSrtTime(item.endTime)}\n${cleanLine(item.en)}${item.ar ? '\n' + cleanLine(item.ar) : ''}`).join('\n\n');
  }

  async function saveLessonToCloud() {
    openMenu(false);
    if (!state.subtitles.length) return toast('Upload SRT first');
    const title = prompt('Lesson name:', `Lesson ${new Date().toLocaleDateString()}`);
    if (!title) return;
    try {
      const sb = await getCloudClient();
      const payload = {
        user_code: CLOUD_CONFIG.userCode,
        title,
        video_url: state.videoUrl && !String(state.videoUrl).startsWith('blob:') ? state.videoUrl : '',
        video_type: state.playerType,
        sync: state.offset,
        dialogue: state.subtitles,
        saved_phrases: state.savedLines.map(normalizeSavedLine),
        saved_words: state.savedWords.map(normalizeSavedWord),
        subtitle_text: buildCurrentSrtText(),
        created_at: new Date().toISOString()
      };
      const { error } = await sb.from('lessons').insert(payload);
      if (error) throw error;
      await upsertCloudUserLibrary(true);
      toast('Lesson saved to cloud');
    } catch (e) { console.error(e); toast('Cloud save failed'); alert('Cloud save failed: ' + (e.message || e)); }
  }

  async function showCloudLibrary() {
    openMenu(false);
    $('savedTitle').textContent = 'Cloud library';
    $('savedBody').innerHTML = `<p>Loading cloud lessons...</p><p class="cloud-sync-hint">${escapeHtml(cloudSyncLabel())}</p>`;
    openModal('savedModal');
    try {
      const sb = await getCloudClient();
      const { data, error } = await sb.from('lessons').select('id,title,video_url,video_type,sync,dialogue,saved_phrases,saved_words,subtitle_text,created_at').eq('user_code', CLOUD_CONFIG.userCode).order('created_at', { ascending:false });
      if (error) throw error;
      state.cloudLessons = data || [];
      $('savedBody').innerHTML = `<div class="saved-item cloud-tools"><b>Saved items sync</b><p>${escapeHtml(cloudSyncLabel())}</p><div class="saved-actions"><button class="small-btn" data-sync-saved-cloud>Sync saved now</button><button class="small-btn" data-load-saved-cloud>Load saved</button></div><small>Words, phrases, saved lines, translations, context, and review progress are stored in Supabase user_library.</small></div>` + (state.cloudLessons.length ? state.cloudLessons.map((l,i)=>`<div class="saved-item cloud-lesson"><b>${escapeHtml(l.title || 'Untitled')}</b><p dir="ltr">${escapeHtml(l.video_url || 'No video link')}</p><small>${new Date(l.created_at).toLocaleString()} • ${Array.isArray(l.dialogue) ? l.dialogue.length : 0} lines</small><div class="saved-actions"><button class="small-btn" data-cloud-load="${i}">Open</button><button class="small-btn" data-cloud-edit="${i}">Edit</button><button class="small-btn danger" data-cloud-delete="${i}">Delete</button></div></div>`).join('') : '<p>No cloud lessons yet.</p>');
    } catch (e) { console.error(e); $('savedBody').innerHTML = '<p>Cloud load failed.</p>'; }
  }


  function pickSubtitleTextFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.srt,.txt,.html,.htm';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => resolve(null);
        r.readAsText(file);
      };
      input.click();
    });
  }

  async function editCloudLesson(i) {
    const lesson = state.cloudLessons[Number(i)]; if (!lesson) return;
    const title = prompt('Lesson title:', lesson.title || 'Untitled');
    if (title === null) return;
    const videoUrl = prompt('Video link / URL:', lesson.video_url || '');
    if (videoUrl === null) return;
    let sync = prompt('Sync offset seconds:', String(Number(lesson.sync || 0)));
    if (sync === null) return;
    sync = Number(sync || 0);

    let dialogue = Array.isArray(lesson.dialogue) ? lesson.dialogue : [];
    let subtitleText = lesson.subtitle_text || '';
    if (confirm('Do you want to replace this lesson subtitles with a new SRT/HTML file?')) {
      const text = await pickSubtitleTextFile();
      if (text) {
        const lower = text.toLowerCase();
        dialogue = (lower.includes('<table') || lower.includes('<tr')) ? parseHtmlTable(text) : parseSrt(text);
        subtitleText = text;
      } else {
        toast('No subtitle file selected');
      }
    }

    try {
      const sb = await getCloudClient();
      const payload = { title: title || 'Untitled', video_url: videoUrl || '', sync, dialogue, subtitle_text: subtitleText };
      const { error } = await sb.from('lessons').update(payload).eq('id', lesson.id).eq('user_code', CLOUD_CONFIG.userCode);
      if (error) throw error;
      toast('Cloud lesson updated');
      await showCloudLibrary();
    } catch (e) { console.error(e); alert('Cloud edit failed: ' + (e.message || e)); }
  }

  async function deleteCloudLesson(i) {
    const lesson = state.cloudLessons[Number(i)]; if (!lesson) return;
    if (!confirm(`Delete lesson "${lesson.title || 'Untitled'}" from cloud?`)) return;
    try {
      const sb = await getCloudClient();
      const { error } = await sb.from('lessons').delete().eq('id', lesson.id).eq('user_code', CLOUD_CONFIG.userCode);
      if (error) throw error;
      toast('Cloud lesson deleted');
      await showCloudLibrary();
    } catch (e) { console.error(e); alert('Cloud delete failed: ' + (e.message || e)); }
  }

  async function loadCloudLesson(i) {
    const lesson = state.cloudLessons[Number(i)]; if (!lesson) return;
    state.subtitles = Array.isArray(lesson.dialogue) ? lesson.dialogue.filter(x => !shouldIgnoreSubtitle(x.en)).map(x => ({...x, time: x.time || formatTime(x.startTime)})) : [];
    state.savedLines = Array.isArray(lesson.saved_phrases) ? lesson.saved_phrases.map(normalizeSavedLine) : state.savedLines;
    state.savedWords = Array.isArray(lesson.saved_words) ? lesson.saved_words.filter(x => !isLaraSettingsCloudItem(x)).map(normalizeSavedWord).filter(x => x.word) : state.savedWords;
    state.offset = Number(lesson.sync || 0); state.activeIndex = -1; state.lastIndex = -1; state.listCenter = 0; state.videoUrl = lesson.video_url || '';
    saveState(); scheduleCloudLibrarySync(); updateControls(); renderList(0); closeModal('savedModal');
    if (state.videoUrl) await loadUrl(state.videoUrl);
    toast('Lesson restored');
  }

  function openMenu(show=true) { el.menuSheet.classList.toggle('hidden', !show); }
  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }
  function updateControls() { el.syncValue.textContent = `${state.offset.toFixed(2)}s`; el.speedBtn.textContent = `${state.speed.toFixed(1)}x`; el.autoPauseBtn.textContent = state.autoPause ? 'On' : 'Off'; if (el.repeatDelayValue) el.repeatDelayValue.textContent = `${state.repeatDelaySeconds}s`; }

  async function loadUrl(url, opts = {}) {
    url = String(url || '').trim(); if (!url) return;
    const originalUrl = url;
    state.videoUrl = originalUrl;
    state.isSeeking = false;
    state.hlsReady = false;
    state.usingCachedVideo = false;
    if (!originalUrl.startsWith('blob:')) localStorage.setItem('jm_video_url', state.videoUrl);
    closeModal('urlModal');
    const yt = extractYtId(originalUrl);
    el.emptyVideo.classList.add('hidden');
    if (yt) return loadYouTube(yt);
    state.playerType = 'html5';
    el.ytHost.classList.add('hidden');
    el.movie.classList.remove('hidden');
    destroyHls();
    el.movie.preload = 'auto';
    el.movie.playsInline = true;
    setStatus('Loading video...');

    let playbackUrl = originalUrl;
    if (opts.useCache !== false && !originalUrl.startsWith('blob:')) playbackUrl = await cachedPlaybackUrl(originalUrl, opts);

    if (/\.m3u8(?:[?#]|$)/i.test(playbackUrl)) await attachHls(playbackUrl);
    else {
      try { el.movie.pause(); } catch {}
      el.movie.src = playbackUrl;
      try { el.movie.load(); } catch {}
      await waitForEvent(el.movie, ['loadedmetadata','canplay'], 4500, () => el.movie.readyState >= 1);
      if (opts.autoplay !== false) playMediaElement();
    }
    el.movie.playbackRate = state.speed;
    if (!state.usingCachedVideo) setStatus('Video loaded');
  }

  function extractYtId(url) { const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/); return m?.[1] || null; }
  async function loadYouTube(id) { state.playerType = 'youtube'; el.movie.classList.add('hidden'); el.ytHost.classList.remove('hidden'); if (!window.YT?.Player) { await loadScript('https://www.youtube.com/iframe_api'); await new Promise(r => { window.onYouTubeIframeAPIReady = r; setTimeout(r, 1500); }); } if (state.yt?.loadVideoById) state.yt.loadVideoById(id); else state.yt = new YT.Player('ytPlayer', { videoId:id, playerVars:{playsinline:1, rel:0, modestbranding:1}, events:{onReady:e=>{e.target.playVideo(); if (e.target.setPlaybackRate) e.target.setPlaybackRate(state.speed);}} }); }
  function destroyHls() { if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; } }
  async function attachHls(url) {
    if (el.movie.canPlayType('application/vnd.apple.mpegurl')) {
      el.movie.src = url;
      try { el.movie.load(); } catch {}
      await waitForEvent(el.movie, ['loadedmetadata','canplay'], 5000, () => el.movie.readyState >= 1);
      playMediaElement();
      state.hlsReady = true;
      return;
    }
    await loadScript('https://cdn.jsdelivr.net/npm/hls.js@latest');
    if (window.Hls?.isSupported()) {
      state.hls = new Hls({
        enableWorker: true,
        backBufferLength: 90,
        maxBufferLength: 45,
        maxMaxBufferLength: 120,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 15000
      });
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => { state.hlsReady = true; playMediaElement(); setStatus('HLS video ready'); });
      state.hls.on(Hls.Events.ERROR, (event, data) => {
        console.warn('HLS error', data);
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { state.hls.startLoad(); setStatus('Recovering video network...'); }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { state.hls.recoverMediaError(); setStatus('Recovering video media...'); }
        else { destroyHls(); toast('HLS playback failed'); }
      });
      state.hls.loadSource(url);
      state.hls.attachMedia(el.movie);
    } else toast('HLS not supported');
  }


  async function recoverVideoPlayback() {
    if (state.playerType !== 'html5') {
      const idx = currentSubtitleIndex();
      if (idx >= 0) seekMedia(state.subtitles[idx].startTime, true);
      return;
    }
    const idx = currentSubtitleIndex();
    const srtTime = idx >= 0 ? state.subtitles[idx].startTime : Math.max(0, (el.movie.currentTime || 0) - state.offset);
    const target = subtitleTimeToMediaTime(srtTime);
    toast('Recovering video...');
    if (canUseTimeFragment(state.videoUrl)) {
      try { el.movie.pause(); } catch {}
      el.movie.src = urlWithTimeFragment(state.videoUrl, target);
      try { el.movie.load(); } catch {}
      await waitForEvent(el.movie, ['loadedmetadata','canplay'], 6500, () => el.movie.readyState >= 1);
    }
    await html5SmartSeek(target, true, { forceReload: true });
  }

  document.addEventListener('click', e => {
    const wordEl = e.target.closest('.word'); if (wordEl) { e.stopPropagation(); pauseMedia(); openDict(wordEl.dataset.word, Number(e.target.closest('[data-index]')?.dataset.index ?? state.lastIndex)); return; }
    const renderBtn = e.target.closest('[data-render-center]'); if (renderBtn) return renderList(Number(renderBtn.dataset.renderCenter));
    const play = e.target.closest('[data-play]'); if (play) { const i = Number(play.dataset.play); state.repeatStart = -1; state.repeatEnd = -1; state.activeIndex = i; state.lastIndex = i; renderList(i); updateDock(state.subtitles[i], -1); seekMedia(state.subtitles[i].startTime, true); return; }
    const rep = e.target.closest('[data-repeat]'); if (rep) {
      const i = Number(rep.dataset.repeat);
      if (state.repeatStart < 0 || state.repeatEnd < 0) {
        setRepeatRange(i, i, true);
        toast('Repeat starts here');
      } else if ((state.repeatStart === i && state.repeatEnd === i) || (i >= state.repeatStart && i <= state.repeatEnd)) {
        stopRepeat();
      } else {
        setRepeatRange(Math.min(state.repeatStart, i), Math.max(state.repeatEnd, i), true);
      }
      renderList(i);
      return;
    }
    const lineMenu = e.target.closest('[data-line-menu]'); if (lineMenu) { const i = Number(lineMenu.dataset.lineMenu); toggleLineActionMenu(i, lineMenu); return; }
    const lineAction = e.target.closest('[data-line-action]'); if (lineAction) {
      e.preventDefault();
      e.stopPropagation();
      const i = Number(lineAction.dataset.index);
      const action = lineAction.dataset.lineAction;
      hideLineActionMenus();
      if (!state.subtitles[i]) return;
      if (action === 'copy') return copyLine(i);
      if (action === 'translate') return translateLine(i);
      if (action === 'save') return saveLine(i);
      if (action === 'phrases') return saveDetectedPhrasesFromLine(i);
      if (action === 'template') return saveTemplateFromSubtitle(i);
      if (action === 'playphrase') return openPlayPhrase(cleanLine(state.subtitles[i]?.en));
      return;
    }
    const savePhrase = e.target.closest('[data-save-phrase]'); if (savePhrase) { savePhraseFromSubtitle(savePhrase.dataset.savePhrase, Number(savePhrase.dataset.index)); return; }
    const ppWord = e.target.closest('[data-pp-word]'); if (ppWord) { openPlayPhrase(ppWord.dataset.ppWord); return; }
    const ppLine = e.target.closest('[data-pp-line]'); if (ppLine) { const item = state.savedLines[Number(ppLine.dataset.ppLine)]; if (item) openPlayPhrase(cleanLine(item.en)); return; }
    const reviewOne = e.target.closest('[data-review-one]'); if (reviewOne) { const [type, index] = reviewOne.dataset.reviewOne.split(':'); showSingleReviewCard(type, index); return; }
    const savedPlay = e.target.closest('[data-saved-play]'); if (savedPlay) { const item = state.savedLines[Number(savedPlay.dataset.savedPlay)]; if (item) { const idx = state.subtitles.findIndex(s => lineKey(s) === item.key || Math.abs((s.startTime||0)-(item.startTime||0)) < .08); closeModal('savedModal'); if (idx >= 0) { renderList(idx); seekMedia(state.subtitles[idx].startTime, true); jumpToCard(idx); } else toast('Open the original lesson first'); } return; }
    const syncSavedCloudBtn = e.target.closest('[data-sync-saved-cloud]'); if (syncSavedCloudBtn) { syncSavedItemsToCloud({ silent: false, reason: 'manual' }); return; }
    const loadSavedCloudBtn = e.target.closest('[data-load-saved-cloud]'); if (loadSavedCloudBtn) { loadSavedItemsFromCloud({ silent: false, merge: true }).then(() => { showSaved('lines'); }); return; }
    const cloudLoad = e.target.closest('[data-cloud-load]'); if (cloudLoad) { loadCloudLesson(cloudLoad.dataset.cloudLoad); return; }
    const cloudEdit = e.target.closest('[data-cloud-edit]'); if (cloudEdit) { editCloudLesson(cloudEdit.dataset.cloudEdit); return; }
    const cloudDelete = e.target.closest('[data-cloud-delete]'); if (cloudDelete) { deleteCloudLesson(cloudDelete.dataset.cloudDelete); return; }
    if (e.target.closest('[data-review-reveal]')) { state.reviewRevealed = true; renderReviewCard(); return; }
    const gradeBtn = e.target.closest('[data-review-grade]'); if (gradeBtn) { const card = e.target.closest('[data-review-key]'); if (card) gradeReview(card.dataset.reviewKey, gradeBtn.dataset.reviewGrade, card.dataset.reviewType || ''); return; }
    if (e.target.closest('[data-show-saved-lines]')) { showSaved('lines'); return; }
    if (!e.target.closest('.line-action-menu')) hideLineActionMenus();
    if (e.target.matches('[data-close-modal]')) closeModal(e.target.dataset.closeModal);
  });

  $('menuBtn').onclick = () => openMenu(true); $('closeMenuBtn').onclick = () => openMenu(false); document.querySelector('.sheet-backdrop').onclick = () => openMenu(false);
  $('urlBtn').onclick = () => openModal('urlModal'); $('loadUrlBtn').onclick = () => loadUrl($('videoUrlInput').value);
  $('videoFileInput').onchange = e => { const f = e.target.files[0]; if (f) loadUrl(URL.createObjectURL(f)); };
  $('subtitleFileInput').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => handleSubtitleContent(r.result); r.readAsText(f); };
  $('menuUploadSrt').onclick = () => { openMenu(false); $('subtitleFileInput').click(); };
  $('menuAzure').onclick = translateAllAzure;
  $('menuLaraAll').onclick = translateAllLara;
  $('menuLaraSettings').onclick = () => openLaraSettings();
  $('menuSavedWords').onclick = () => { openMenu(false); showSaved('words'); };
  if ($('menuSavedPhrases')) $('menuSavedPhrases').onclick = () => { openMenu(false); showSaved('phrases'); };
  if ($('menuSavedTemplates')) $('menuSavedTemplates').onclick = () => { openMenu(false); showSaved('templates'); };
  if ($('menuExtractTemplates')) $('menuExtractTemplates').onclick = saveTemplatesFromAllSubtitles;
  $('menuSavedLines').onclick = () => { openMenu(false); showSaved('lines'); };
  $('menuReviewCards').onclick = showReviewCards;
  $('menuSaveCloud').onclick = saveLessonToCloud;
  if ($('menuSyncSavedCloud')) $('menuSyncSavedCloud').onclick = () => { openMenu(false); syncSavedItemsToCloud({ silent: false, reason: 'manual' }); };
  if ($('menuLoadSavedCloud')) $('menuLoadSavedCloud').onclick = () => { openMenu(false); loadSavedItemsFromCloud({ silent: false, merge: true }).then(() => showSaved('lines')); };
  $('menuCloudLibrary').onclick = showCloudLibrary;
  if ($('menuRecoverVideo')) $('menuRecoverVideo').onclick = () => { openMenu(false); recoverVideoPlayback(); };
  if ($('menuCacheVideo')) $('menuCacheVideo').onclick = () => { openMenu(false); cacheCurrentVideo(); };
  if ($('menuUseCache')) $('menuUseCache').onclick = () => { openMenu(false); useCachedVideo(); };
  if ($('menuClearCache')) $('menuClearCache').onclick = () => { openMenu(false); clearCurrentVideoCache(); };
  $('menuClear').onclick = () => { if(confirm('Start a new lesson?')) { localStorage.removeItem('jm_subtitles'); localStorage.removeItem('jm_video_url'); localStorage.removeItem('jm_last_lesson_saved_at'); state.videoUrl=''; state.subtitles=[]; state.activeIndex=-1; state.lastIndex=-1; state.repeatStart=-1; state.repeatEnd=-1; try { el.movie.pause(); el.movie.removeAttribute('src'); el.movie.load(); } catch {} if (state.videoBlobUrl) { try { URL.revokeObjectURL(state.videoBlobUrl); } catch {} state.videoBlobUrl=''; } state.usingCachedVideo=false; el.movie.classList.add('hidden'); el.ytHost.classList.add('hidden'); el.emptyVideo.classList.remove('hidden'); state.playerType='none'; renderList(0); updateDock(null); setStatus('New lesson'); openMenu(false); } };
  $('speedBtn').onclick = () => { const opts=[.5,.75,1,1.25,1.5,2]; state.speed = opts[(opts.indexOf(state.speed)+1)%opts.length] || 1; if (state.playerType === 'html5') el.movie.playbackRate = state.speed; if (state.yt?.setPlaybackRate) state.yt.setPlaybackRate(state.speed); updateControls(); debounceSave(); };
  $('syncMinus').onclick = () => { state.offset -= .25; updateControls(); debounceSave(); };
  $('syncPlus').onclick = () => { state.offset += .25; updateControls(); debounceSave(); };
  if ($('repeatDelayMinus')) $('repeatDelayMinus').onclick = () => { state.repeatDelaySeconds = Math.max(1, Number(state.repeatDelaySeconds || 1) - 1); updateControls(); debounceSave(); toast(`Repeat pause: ${state.repeatDelaySeconds}s`); };
  if ($('repeatDelayPlus')) $('repeatDelayPlus').onclick = () => { state.repeatDelaySeconds = Math.min(5, Number(state.repeatDelaySeconds || 1) + 1); updateControls(); debounceSave(); toast(`Repeat pause: ${state.repeatDelaySeconds}s`); };
  $('autoPauseBtn').onclick = () => { state.autoPause = !state.autoPause; updateControls(); };
  $('goActiveBtn').onclick = () => jumpToCard(currentSubtitleIndex() >= 0 ? currentSubtitleIndex() : 0);
  el.subtitleDock.onclick = () => jumpToCard(currentSubtitleIndex());
  $('jumpCurrentBtn').onclick = () => jumpToCard(currentSubtitleIndex());
  $('loopCurrentBtn').onclick = repeatCurrentSubtitle;
  $('loopStartBtn').onclick = setLoopStartFromCurrent;
  $('loopEndBtn').onclick = setLoopEndFromCurrent;
  $('loopOffBtn').onclick = stopRepeat;
  $('saveLineBtn').onclick = () => saveLine(currentSubtitleIndex());
  $('copyLineBtn').onclick = () => copyLine(currentSubtitleIndex());
  $('translateLineBtn').onclick = () => translateLine(currentSubtitleIndex());
  $('playPhraseLineBtn').onclick = () => { const item = state.subtitles[currentSubtitleIndex()]; if (item) openPlayPhrase(cleanLine(item.en)); };
  if ($('saveLaraSettingsBtn')) $('saveLaraSettingsBtn').onclick = async () => {
    const cfg = saveLaraConfigToLocal();
    if (!cfg.accessKeyId || !cfg.accessKeySecret) { $('laraSettingsStatus').textContent = 'Please enter both Lara Access Key ID and Secret.'; return toast('Missing Lara keys'); }
    $('laraSettingsStatus').textContent = 'Saving Lara settings locally and to Supabase...';
    const ok = await saveLaraSettingsToCloud({ silent: true });
    $('laraSettingsStatus').textContent = ok ? 'Lara settings saved locally and in Supabase.' : 'Lara settings saved locally, but cloud sync failed. Try Menu → Cloud library → Sync saved now.';
    toast(ok ? 'Lara saved to cloud' : 'Lara saved locally');
  };
  if ($('testLaraSettingsBtn')) $('testLaraSettingsBtn').onclick = async () => {
    const cfg = saveLaraConfigToLocal();
    if (!cfg.accessKeyId || !cfg.accessKeySecret) { $('laraSettingsStatus').textContent = 'Please enter both Lara Access Key ID and Secret first.'; return toast('Missing Lara keys'); }
    $('laraSettingsStatus').textContent = 'Testing Lara translation...';
    try {
      const sample = await translateLara('I have got some time.');
      await saveLaraSettingsToCloud({ silent: true });
      $('laraSettingsStatus').textContent = `Lara works. Sample: ${sample}`;
      toast('Lara test passed');
    } catch (e) {
      $('laraSettingsStatus').textContent = e.message || String(e);
      toast('Lara test failed');
    }
  };
  if ($('clearLaraSettingsBtn')) $('clearLaraSettingsBtn').onclick = async () => {
    localStorage.removeItem('jm_lara_access_key_id'); localStorage.removeItem('jm_lara_access_key_secret');
    $('laraKeyIdInput').value = ''; $('laraSecretInput').value = '';
    $('laraSettingsStatus').textContent = 'Lara settings cleared locally. Syncing removal to Supabase...';
    const ok = await syncSavedItemsToCloud({ silent: true, reason: 'lara-clear' });
    $('laraSettingsStatus').textContent = ok ? 'Lara settings cleared locally and from Supabase.' : 'Local Lara settings cleared, but cloud sync failed.';
    toast('Lara cleared');
  };

  el.movie.addEventListener('loadedmetadata', () => { el.movie.playbackRate = state.speed; });
  el.movie.addEventListener('waiting', () => { if (state.playerType === 'html5') setStatus('Buffering video...'); });
  el.movie.addEventListener('stalled', () => { if (state.playerType === 'html5') setStatus('Video stalled. Use Menu → Recover video if it does not resume.'); });
  el.movie.addEventListener('playing', () => { if (state.playerType === 'html5' && !state.isSeeking) setStatus('Playing'); });

  state.savedWords = state.savedWords.map(normalizeSavedWord).filter(x => x.word && !isLaraSettingsCloudItem(x));
  state.savedLines = state.savedLines.map(normalizeSavedLine);
  loadSavedItemsFromCloud({ silent: true, merge: true }).then(ok => { if (ok) setStatus(`Saved items ready from cloud • ${state.savedWords.length + state.savedLines.length} cards`); });
  const savedSubs = readJSON('jm_subtitles', []);
  const savedUrl = localStorage.getItem('jm_video_url') || '';
  if (savedSubs.length) {
    state.subtitles = savedSubs.filter(x => !shouldIgnoreSubtitle(x.en)).map(x => ({...x, time: x.time || formatTime(x.startTime)}));
    renderList(0);
    setStatus(`${state.subtitles.length} subtitles restored`);
  }
  if (savedUrl && !savedUrl.startsWith('blob:')) {
    state.videoUrl = savedUrl;
    const input = $('videoUrlInput'); if (input) input.value = savedUrl;
    setTimeout(() => loadUrl(savedUrl), 250);
  }
  updateControls(); syncLoop();
})();
