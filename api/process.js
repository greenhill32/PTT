// Vercel Node function. No audio or transcript is stored server-side.
const MAX_AUDIO_BYTES = 2_500_000;
const CATEGORIES = ['Task', 'Idea', 'Observation', 'Gym_Log', 'Noise'];

function send(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(data);
}

async function codeMatches(provided, expected) {
  if (typeof provided !== 'string' || provided.length > 256) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function openai(path, options, key) {
  const response = await fetch('https://api.openai.com/v1/' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + key, ...(options.headers || {}) },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error('AI provider returned ' + response.status);
  return response.json();
}

function validSuggestions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).filter(x => x && typeof x.text === 'string' && x.text.trim()).map(x => ({
    text: x.text.trim().slice(0, 2000),
    category: CATEGORIES.includes(x.category) ? x.category : 'Observation',
    priority: Number.isInteger(x.priority) && x.priority >= 1 && x.priority <= 10 ? x.priority : null
  }));
}

export default async function handler(req, res) {
  const key = process.env.OPENAI_API_KEY;
  const accessCode = process.env.PTT_PROCESSING_CODE;
  const ready = Boolean(key && accessCode && accessCode.length >= 24);
  if (req.method === 'GET') return send(res, 200, { ready });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  if (!ready) return send(res, 503, { error: 'AI is not configured. Manual transcript is available.' });
  if (!(await codeMatches(req.headers['x-ptt-code'], accessCode))) return send(res, 401, { error: 'Processing code is incorrect.' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Expected JSON.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.audio !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio) ||
        body.audio.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8) {
      return send(res, 400, { error: 'Audio is missing or too large (2.5 MB limit).' });
    }
    const mime = typeof body.mime === 'string' && body.mime.startsWith('audio/mp4') ? 'audio/mp4' :
      typeof body.mime === 'string' && body.mime.startsWith('audio/webm') ? 'audio/webm' : '';
    if (!mime) {
      return send(res, 400, { error: 'Unsupported audio format.' });
    }
    const bytes = Buffer.from(body.audio, 'base64');
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return send(res, 400, { error: 'Audio is empty or too large.' });
    const form = new FormData();
    form.append('model', 'gpt-transcribe');
    form.append('file', new Blob([bytes], { type: mime }), mime === 'audio/mp4' ? 'thought.m4a' : 'thought.webm');
    const speech = await openai('audio/transcriptions', { method: 'POST', body: form }, key);
    const transcript = String(speech.text || '').trim().slice(0, 6000);
    if (!transcript) return send(res, 422, { error: 'No speech was detected. Your clip is unchanged.' });

    // If categorization fails, return the transcript for local review rather than lose the successful transcription.
    let suggestions = [{ text: transcript, category: 'Observation', priority: null }];
    let warning = '';
    try {
      const schema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                category: { type: 'string', enum: CATEGORIES },
                priority: { type: ['integer', 'null'] }
              },
              required: ['text', 'category', 'priority'], additionalProperties: false
            }
          }
        },
        required: ['items'], additionalProperties: false
      };
      const ai = await openai('responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-6-luna', reasoning: { effort: 'low' }, max_output_tokens: 1200,
          instructions: 'Split this dictation into separate useful thoughts. Output JSON. Categories: Task, Idea, Observation, Gym_Log, Noise. Never invent a task, person, date, or detail. Noise is a suggestion for user review, never automatic deletion. Give a priority integer 1-10 ONLY when the speaker explicitly says priority N, score N, RPE N, or REP N. Otherwise null. Remove the spoken score phrase from item text. Preserve intended meaning. At most eight items.',
          input: transcript,
          text: { format: { type: 'json_schema', name: 'dictaphone_items', strict: true, schema } }
        })
      }, key);
      const output = (ai.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
      const parsed = JSON.parse(output);
      const valid = validSuggestions(parsed.items);
      if (valid.length) suggestions = valid;
      else warning = 'Transcript saved; no useful categories were returned, so review the single item.';
    } catch {
      warning = 'Transcript saved; AI sorting was unavailable, so review the single item.';
    }
    return send(res, 200, { transcript, suggestions, warning });
  } catch (error) {
    return send(res, 502, { error: error?.name === 'TimeoutError' ? 'Processing timed out. Try again later.' : 'Transcription failed. Your local clip is unchanged.' });
  }
}
