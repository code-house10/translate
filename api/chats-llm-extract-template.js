// Vercel Serverless Function: /api/chats-llm-extract-template
// Extracts a reusable sentence template from a subtitle line using an OpenAI-compatible Chats-LLM API.

const DEFAULT_BASE_URL = 'https://chats-llm.com/api/v1';
const FALLBACK_MODEL = process.env.CHATS_LLM_MODEL || '';

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
  const direct = cleanLine(requestedModel || FALLBACK_MODEL);
  if (direct) return direct;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await res.json().catch(() => ({}));
    const first = Array.isArray(data?.data) ? data.data.find(m => m?.id)?.id : '';
    if (first) return first;
  } catch {}
  return 'auto';
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const apiKey = cleanLine(process.env.CHATS_LLM_API_KEY || body.apiKey || req.headers['x-chats-llm-key'] || '');
    if (!apiKey) return res.status(400).json({ error: 'Chats-LLM API key is missing. Add it in AI examples settings or set CHATS_LLM_API_KEY in Vercel.' });
    const line = cleanLine(body.line || '');
    if (!line || (line.match(/[A-Za-z]/g) || []).length < 8) return res.status(400).json({ error: 'A longer English subtitle line is required.' });
    const baseUrl = cleanLine(process.env.CHATS_LLM_BASE_URL || body.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = await chooseModel(baseUrl, apiKey, body.model);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You extract reusable English sentence templates and generate natural Arabic-supported examples. Return strict JSON only.' },
          { role: 'user', content: buildPrompt(line) }
        ],
        temperature: 0.25,
        max_tokens: 950,
        stream: false
      })
    });
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || data?.error || data?.message || raw || `Chats-LLM error ${response.status}`, details: data });
    const content = data?.choices?.[0]?.message?.content || data?.output || data?.message || raw;
    const parsed = parseJsonLoose(content);
    const template = normalizeTemplate(parsed, line);
    if (!template) return res.status(502).json({ error: 'AI returned no valid reusable template.', raw: content });
    return res.status(200).json({ template, model });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
