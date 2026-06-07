// Vercel Serverless Function: /api/mymemory-translate
// Used for on-demand subtitle/word/example translation through MyMemory.

const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const DEFAULT_SOURCE = 'en';
const DEFAULT_TARGET = 'ar';
const MAX_BYTES = 450;

function byteLengthUtf8(text) {
  return new TextEncoder().encode(String(text || '')).length;
}

function splitText(text, maxBytes = MAX_BYTES) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (byteLengthUtf8(clean) <= maxBytes) return [clean];

  const sentenceParts = clean.match(/[^.!?؟。]+[.!?؟。]*/g) || [clean];
  const chunks = [];
  let buffer = '';

  const pushBuffer = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = '';
  };

  for (const part of sentenceParts) {
    const candidate = `${buffer} ${part}`.trim();
    if (byteLengthUtf8(candidate) <= maxBytes) {
      buffer = candidate;
      continue;
    }
    pushBuffer();

    if (byteLengthUtf8(part) <= maxBytes) {
      buffer = part.trim();
    } else {
      let wordBuffer = '';
      for (const word of part.split(/\s+/)) {
        const wordCandidate = `${wordBuffer} ${word}`.trim();
        if (byteLengthUtf8(wordCandidate) <= maxBytes) {
          wordBuffer = wordCandidate;
        } else {
          if (wordBuffer) chunks.push(wordBuffer);
          wordBuffer = word;
        }
      }
      if (wordBuffer) chunks.push(wordBuffer);
    }
  }
  pushBuffer();
  return chunks;
}

async function translateSegment(text, source, target) {
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${source}|${target}`)}`;
  const response = await fetch(url);
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`MyMemory error ${response.status}: ${raw}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error('MyMemory returned invalid JSON.');
  }

  return data?.responseData?.translatedText || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const text = String(req.body?.text || '').trim();
    const source = String(req.body?.source || DEFAULT_SOURCE).trim();
    const target = String(req.body?.target || DEFAULT_TARGET).trim();

    if (!text) {
      return res.status(400).json({ error: 'No text was provided.' });
    }

    const chunks = splitText(text);
    const translatedParts = [];

    for (const chunk of chunks) {
      translatedParts.push(await translateSegment(chunk, source, target));
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    return res.status(200).json({ translatedText: translatedParts.join(' ').replace(/\s+/g, ' ').trim() });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
}
