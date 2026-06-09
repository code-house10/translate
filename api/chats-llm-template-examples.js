// Vercel Serverless Function: /api/chats-llm-template-examples
// Generates complete, natural daily-life examples for saved sentence templates.
// Lara remains reserved for subtitle-line translation only.

const DEFAULT_BASE_URL = 'https://chats-llm.com/api/v1';
const FALLBACK_MODEL = process.env.CHATS_LLM_MODEL || '';

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
  const direct = cleanLine(requestedModel || FALLBACK_MODEL);
  if (direct) return direct;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const data = await res.json().catch(() => ({}));
    const first = Array.isArray(data?.data) ? data.data.find(m => m?.id)?.id : '';
    if (first) return first;
  } catch {}
  return 'auto';
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = cleanLine(process.env.CHATS_LLM_API_KEY || req.body?.apiKey || req.headers['x-chats-llm-key'] || '');
    if (!apiKey) {
      return res.status(400).json({ error: 'Chats-LLM API key is missing. Add it in AI examples settings or set CHATS_LLM_API_KEY in Vercel.' });
    }

    const pattern = cleanLine(req.body?.pattern || '');
    if (!pattern || !/\[.+?\]/.test(pattern)) {
      return res.status(400).json({ error: 'A valid template with [placeholder] is required.' });
    }

    const baseUrl = cleanLine(process.env.CHATS_LLM_BASE_URL || req.body?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = await chooseModel(baseUrl, apiKey, req.body?.model);
    const prompt = buildPrompt({
      pattern,
      contextEn: cleanLine(req.body?.contextEn || ''),
      slot: cleanLine(req.body?.slot || ''),
      usageEn: cleanLine(req.body?.usageEn || ''),
      usageAr: cleanLine(req.body?.usageAr || '')
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You generate natural English learning examples and Arabic translations. Return strict JSON only.' },
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
      return res.status(response.status).json({
        error: data?.error?.message || data?.error || data?.message || raw || `Chats-LLM error ${response.status}`,
        details: data
      });
    }

    const content = data?.choices?.[0]?.message?.content || data?.output || data?.message || raw;
    const parsed = parseJsonLoose(content);
    const examples = dedupeAndFilter(parsed?.examples || [], 3);

    if (!examples.length) {
      return res.status(502).json({ error: 'AI returned no valid complete examples.', raw: content });
    }

    return res.status(200).json({ examples, model });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
}
