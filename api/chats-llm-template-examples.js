// Vercel Serverless Function: /api/chats-llm-template-examples
// Generates complete, natural daily-life examples for saved sentence templates.
// Lara remains reserved for subtitle-line translation only.

const DEFAULT_BASE_URL = 'https://chats-llm.com/api/v1';
const FALLBACK_MODEL = process.env.CHATS_LLM_MODEL || '';

const FREE_MODEL_PRIORITY = [
  'moonshotai/kimi-k2.6:free',
  'stepfun/step-3.7-flash:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'z-ai/glm-4.5-air:free',
  'qwen/qwen3-coder:free',
  'poolside/laguna-m.1:free',
  'nex-agi/nex-n2-pro:free',
  'openrouter/free',
  'kilo-auto/free'
];

function freeModelAlias(model) {
  const id = cleanLine(model).toLowerCase();
  if (!id) return '';
  const aliases = {
    'auto': '',
    'free': 'openrouter/free',
    'openrouter': 'openrouter/free',
    'openrouter/free': 'openrouter/free',
    'kilo-auto/free': 'kilo-auto/free',
    'kilo/free': 'kilo-auto/free',
    'kimi': 'moonshotai/kimi-k2.6:free',
    'kimi-k2.6': 'moonshotai/kimi-k2.6:free',
    'moonshotai/kimi-k2.6': 'moonshotai/kimi-k2.6:free',
    'step': 'stepfun/step-3.7-flash:free',
    'stepfun/step-3.7-flash': 'stepfun/step-3.7-flash:free',
    'llama': 'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct': 'meta-llama/llama-3.3-70b-instruct:free',
    'gpt-oss-120b': 'openai/gpt-oss-120b:free',
    'openai/gpt-oss-120b': 'openai/gpt-oss-120b:free',
    'gpt-oss-20b': 'openai/gpt-oss-20b:free',
    'openai/gpt-oss-20b': 'openai/gpt-oss-20b:free',
    'qwen': 'qwen/qwen3-next-80b-a3b-instruct:free',
    'qwen/qwen3-next-80b-a3b-instruct': 'qwen/qwen3-next-80b-a3b-instruct:free'
  };
  if (aliases[id] !== undefined) return aliases[id];
  if (isFreeModelId(id)) return cleanLine(model);
  return '';
}

function isFreeModelId(model) {
  const id = cleanLine(model).toLowerCase();
  return Boolean(id && (id.endsWith(':free') || id === 'openrouter/free' || id === 'kilo-auto/free' || id.includes('/free')));
}

function modelPriorityScore(id) {
  const lower = cleanLine(id).toLowerCase();
  const idx = FREE_MODEL_PRIORITY.findIndex(x => x.toLowerCase() === lower);
  if (idx >= 0) return idx;
  if (/content-safety|guard|moderation|safety|lyria|image|vision|vl\b|audio|tts|speech|clip/.test(lower)) return 9999;
  if (/kimi|step|llama|qwen|gpt-oss|gemma|glm|hermes/.test(lower)) return 100;
  if (lower === 'openrouter/free' || lower === 'kilo-auto/free') return 120;
  return 500;
}

function chooseBestFreeModel(models) {
  const ids = (Array.isArray(models) ? models : [])
    .map(m => cleanLine(m?.id || m))
    .filter(isFreeModelId);
  const unique = [...new Set(ids)];
  for (const preferred of FREE_MODEL_PRIORITY) {
    const found = unique.find(id => id.toLowerCase() === preferred.toLowerCase());
    if (found) return found;
  }
  unique.sort((a, b) => modelPriorityScore(a) - modelPriorityScore(b));
  return unique[0] || '';
}


function cleanLine(text) {
  return String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function stripJsonFence(text) {
  return String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonLoose(text) {
  const raw = stripJsonFence(text);
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function hasLatin(text) { return /[A-Za-z]/.test(String(text || '')); }
function hasArabic(text) { return /[\u0600-\u06FF]/.test(String(text || '')); }

function looksBadEnglishExample(text) {
  const t = cleanLine(text);
  if (!t || !hasLatin(t)) return true;
  if (/\[.*?\]/.test(t)) return true;
  if (/\b(examples? of template|using the same template|same template|in my own situation)\b/i.test(t)) return true;
  if (/\bleft\s+on\s+in\b/i.test(t)) return true;
  if (/\b(on|in|at|for|with|to|of|from|by|about)\s+(on|in|at|for|with|to|of|from|by|about)\b/i.test(t)) return true;
  if (/\b(?:on|in|at|for|with|to|of|from|by|about|the|a|an)\s*[.!?]?$/i.test(t)) return true;
  const words = (t.match(/[A-Za-z']+/g) || []).length;
  return words < 4;
}

function normalizeExample(ex) {
  return {
    en: cleanLine(ex?.en || ex?.english || ''),
    ar: cleanLine(ex?.ar || ex?.arabic || ''),
    slot: cleanLine(ex?.slot || ex?.replacement || ''),
    source: 'chats-llm'
  };
}

function dedupeAndFilter(examples, limit = 3) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(examples) ? examples : []) {
    const item = normalizeExample(raw);
    if (looksBadEnglishExample(item.en)) continue;
    if (!hasArabic(item.ar)) continue;
    const key = item.en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function chooseModel(baseUrl, apiKey, requestedModel) {
  const direct = freeModelAlias(requestedModel || FALLBACK_MODEL);
  if (direct) return direct;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const data = await res.json().catch(() => ({}));
    const free = chooseBestFreeModel(data?.data || []);
    if (free) return free;
  } catch {}
  // Final safe fallback from the public free model list. Never fall back to a paid/non-free model.
  return 'openrouter/free';
}
async function getFreeModelCandidates(baseUrl, apiKey, requestedModel) {
  const out = [];
  const add = (m) => { const id = freeModelAlias(m) || (isFreeModelId(m) ? cleanLine(m) : ''); if (id && !out.some(x => x.toLowerCase() === id.toLowerCase())) out.push(id); };
  add(requestedModel || FALLBACK_MODEL);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await res.json().catch(() => ({}));
    const ids = (Array.isArray(data?.data) ? data.data : []).map(m => cleanLine(m?.id || m)).filter(isFreeModelId);
    ids.sort((a, b) => modelPriorityScore(a) - modelPriorityScore(b));
    ids.forEach(add);
  } catch {}
  FREE_MODEL_PRIORITY.forEach(add);
  add('openrouter/free');
  return out;
}


function buildPrompt({ pattern, contextEn, slot, usageEn, usageAr }) {
  return `You are helping an Arabic-speaking English learner learn reusable sentence templates from movies.

TASK:
Given an English sentence template containing bracket placeholders like [do something], create 3 natural, complete, everyday English examples by replacing the bracket part with realistic daily-life situations. Also translate each example into natural Arabic.

STRICT RULES:
- Output JSON only. No markdown. No explanations.
- Do not return the template itself.
- Do not keep brackets [] in examples.
- Each English example must be a complete, natural sentence a native speaker could say in daily life.
- Examples must be useful for real situations, not strange movie-only situations.
- Avoid awkward phrases like "in my own situation", "examples of template", or sentences ending with a preposition.
- Keep the same grammar structure and tone of the template.
- Arabic translations should be natural and concise, not literal word-for-word.
- If the template is annoyed, funny, casual, or polite, keep that tone.

Return exactly this JSON shape:
{
  "examples": [
    {"slot": "replacement words used", "en": "Complete English example.", "ar": "الترجمة العربية الطبيعية."}
  ]
}

Template: ${pattern}
Original movie line/context: ${contextEn || ''}
Original slot if known: ${slot || ''}
Usage in English: ${usageEn || ''}
Usage in Arabic: ${usageAr || ''}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-chats-llm-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const apiKey = cleanLine(process.env.CHATS_LLM_API_KEY || body.apiKey || req.headers['x-chats-llm-key'] || '');
    if (!apiKey) {
      return res.status(400).json({ error: 'Chats-LLM API key is missing. Add it in AI examples settings or set CHATS_LLM_API_KEY in Vercel.' });
    }

    const pattern = cleanLine(body.pattern || '');
    if (!pattern || !/\[.+?\]/.test(pattern)) {
      return res.status(400).json({ error: 'A valid template with [placeholder] is required.' });
    }

    const baseUrl = cleanLine(process.env.CHATS_LLM_BASE_URL || body.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const prompt = buildPrompt({
      pattern,
      contextEn: cleanLine(body.contextEn || ''),
      slot: cleanLine(body.slot || ''),
      usageEn: cleanLine(body.usageEn || ''),
      usageAr: cleanLine(body.usageAr || '')
    });
    const modelsToTry = await getFreeModelCandidates(baseUrl, apiKey, body.model);
    const attempted = [];
    let lastError = '';

    for (const model of modelsToTry) {
      attempted.push(model);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You generate natural, complete daily-life English examples and natural Arabic translations. Return strict JSON only. Never leave placeholders or brackets.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.35,
          max_tokens: 900,
          stream: false
        })
      });

      const raw = await response.text();
      let data = {};
      try { data = JSON.parse(raw); } catch { data = { raw }; }

      if (!response.ok) {
        lastError = data?.error?.message || data?.error || data?.message || raw || `Chats-LLM error ${response.status}`;
        if ([401, 403].includes(response.status)) {
          return res.status(response.status).json({ error: lastError, details: data, attempted });
        }
        continue;
      }

      const content = data?.choices?.[0]?.message?.content || data?.output || data?.message || raw;
      const parsed = parseJsonLoose(content);
      const examples = dedupeAndFilter(parsed?.examples || [], 3);
      if (examples.length) return res.status(200).json({ examples, model, attempted });
      lastError = 'AI returned no valid complete examples.';
    }

    return res.status(502).json({ error: lastError || 'No free Chats-LLM model returned valid examples.', attempted });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
}
