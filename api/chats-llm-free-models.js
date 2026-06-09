// Vercel Serverless Function: /api/chats-llm-free-models
// Lists only the free Chats-LLM models currently visible from /api/v1/models.

const DEFAULT_BASE_URL = 'https://chats-llm.com/api/v1';
const PRIORITY = [
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
function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function isFree(id) {
  const x = clean(id).toLowerCase();
  return Boolean(x && (x.endsWith(':free') || x === 'openrouter/free' || x === 'kilo-auto/free' || x.includes('/free')));
}
function score(id) {
  const lower = clean(id).toLowerCase();
  const idx = PRIORITY.findIndex(x => x.toLowerCase() === lower);
  if (idx >= 0) return idx;
  if (/content-safety|guard|moderation|safety|lyria|image|vision|vl\b|audio|tts|speech|clip/.test(lower)) return 9999;
  if (/kimi|step|llama|qwen|gpt-oss|gemma|glm|hermes/.test(lower)) return 100;
  return 500;
}
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-chats-llm-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const apiKey = clean(process.env.CHATS_LLM_API_KEY || req.headers['x-chats-llm-key'] || '');
    const baseUrl = clean(process.env.CHATS_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const r = await fetch(`${baseUrl}/models`, { headers });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || data?.error || data?.message || `Models request failed ${r.status}` });
    const models = [...new Set((data?.data || []).map(m => clean(m?.id || m)).filter(isFree))]
      .sort((a, b) => score(a) - score(b));
    res.status(200).json({ models, recommended: models[0] || 'openrouter/free' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
