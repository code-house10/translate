// Vercel Serverless Function: /api/chats-llm-extract-template
// Extracts a reusable sentence template from a subtitle line using an OpenAI-compatible Chats-LLM API.

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
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}
function parseJsonLoose(text) {
  const raw = stripJsonFence(text);
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}
function hasArabic(text) { return /[\u0600-\u06FF]/.test(String(text || '')); }
function looksBadPattern(pattern) {
  const p = cleanLine(pattern);
  if (!p || !/\[.+?\]/.test(p)) return true;
  if (/examples? of template|same template|in my own situation/i.test(p)) return true;
  if (/(?:on|in|at|for|with|to|of|from|by|about)\s+(?:on|in|at|for|with|to|of|from|by|about)\b/i.test(p)) return true;
  const words = (p.match(/[A-Za-z']+/g) || []).length;
  return words < 4;
}
function looksBadExample(text) {
  const t = cleanLine(text);
  if (!t || !/[A-Za-z]/.test(t)) return true;
  if (/\[.+?\]/.test(t)) return true;
  if (/examples? of template|same template|in my own situation/i.test(t)) return true;
  if (/(?:on|in|at|for|with|to|of|from|by|about)\s+(?:on|in|at|for|with|to|of|from|by|about)\b/i.test(t)) return true;
  if (/\b(?:on|in|at|for|with|to|of|from|by|about|the|a|an)\s*[.!?]?$/i.test(t)) return true;
  const words = (t.match(/[A-Za-z']+/g) || []).length;
  return words < 4;
}
function normalizeTemplate(raw, sourceLine) {
  const t = raw?.template || raw || {};
  const examples = Array.isArray(t.examples) ? t.examples.map(x => ({
    en: cleanLine(x?.en || x?.english || ''),
    ar: cleanLine(x?.ar || x?.arabic || ''),
    slot: cleanLine(x?.slot || x?.replacement || ''),
    source: 'chats-llm'
  })).filter(x => !looksBadExample(x.en) && hasArabic(x.ar)).slice(0, 3) : [];
  const out = {
    pattern: cleanLine(t.pattern || ''),
    slot: cleanLine(t.slot || ''),
    usageEn: cleanLine(t.usageEn || t.usage || ''),
    usageAr: cleanLine(t.usageAr || ''),
    examples,
    source: cleanLine(sourceLine || '')
  };
  if (looksBadPattern(out.pattern)) return null;
  return out;
}
async function chooseModel(baseUrl, apiKey, requestedModel) {
  const direct = freeModelAlias(requestedModel || FALLBACK_MODEL);
  if (direct) return direct;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
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

function buildPrompt(line) {
  return `You are helping an Arabic-speaking English learner turn movie subtitle lines into reusable sentence templates.

TASK:
Analyze this English subtitle line and extract ONE useful, reusable sentence template.

STRICT RULES:
- Output JSON only. No markdown. No explanations.
- The template MUST contain one bracket placeholder like [do something], [someone], [something], [somewhere], or [time].
- Do not create a strange or incomplete template.
- Keep the original grammar, tone, and useful fixed phrase.
- Choose a template that can be reused in daily-life situations.
- Also give 3 complete natural daily-life examples using the same template.
- Translate usage and examples into natural Arabic.
- If the line contains more than one sentence, choose the most reusable one.

Return exactly this JSON:
{
  "template": {
    "pattern": "Reusable English template with [placeholder].",
    "slot": "the original part replaced by the placeholder",
    "usageEn": "When to use this template in simple English.",
    "usageAr": "شرح الاستخدام بالعربي.",
    "examples": [
      {"slot": "replacement", "en": "Complete natural English example.", "ar": "ترجمة عربية طبيعية."}
    ]
  }
}

Subtitle line: ${line}`;
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
    if (!apiKey) return res.status(400).json({ error: 'Chats-LLM API key is missing. Add it in AI examples settings or set CHATS_LLM_API_KEY in Vercel.' });
    const line = cleanLine(body.line || '');
    if (!line || (line.match(/[A-Za-z]/g) || []).length < 8) return res.status(400).json({ error: 'A longer English subtitle line is required.' });
    const baseUrl = cleanLine(process.env.CHATS_LLM_BASE_URL || body.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const modelsToTry = await getFreeModelCandidates(baseUrl, apiKey, body.model);
    const attempted = [];
    let lastError = '';
    const prompt = buildPrompt(line);

    for (const model of modelsToTry) {
      attempted.push(model);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You extract reusable English sentence templates and generate complete natural Arabic-supported examples. Return strict JSON only. Never leave placeholders in examples.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.25,
          max_tokens: 950,
          stream: false
        })
      });
      const raw = await response.text();
      let data = {};
      try { data = JSON.parse(raw); } catch { data = { raw }; }
      if (!response.ok) {
        lastError = data?.error?.message || data?.error || data?.message || raw || `Chats-LLM error ${response.status}`;
        if ([401, 403].includes(response.status)) return res.status(response.status).json({ error: lastError, details: data, attempted });
        continue;
      }
      const content = data?.choices?.[0]?.message?.content || data?.output || data?.message || raw;
      const parsed = parseJsonLoose(content);
      const template = normalizeTemplate(parsed, line);
      if (template) return res.status(200).json({ template, model, attempted });
      lastError = 'AI returned no valid reusable template.';
    }
    return res.status(502).json({ error: lastError || 'No free Chats-LLM model returned a valid reusable template.', attempted });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
