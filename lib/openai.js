// ─── OpenAI o3 caller ─────────────────────────────────────────────────────────
// Handles text + image (vision) inputs, with timeout and structured error info.
// o3 is a reasoning model — it performs an internal chain-of-thought pass before
// producing its final answer, which is why the timeout and token budget are much
// higher than a standard chat model.

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL           = 'o3';
const TIMEOUT_MS      = 120000; // 2 min — o3 reasoning can take 30-90 s

export async function callOpenAI({ apiKey, systemPrompt, userPrompt, imageAttachments = [] }) {
  // Build the user message content — text first, then images
  const userContent = [
    { type: 'text', text: userPrompt }
  ];

  // Attach images as base64 vision inputs (max 10 to stay within token budget)
  const images = imageAttachments.slice(0, 10);
  for (const img of images) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.contentType};base64,${img.base64}`,
        detail: 'high' // 'high' for full detail — appropriate for o3
      }
    });
  }

  const body = {
    model: MODEL,
    // o3 uses max_completion_tokens (covers reasoning tokens + final output).
    // Reasoning-heavy responses can consume thousands of tokens internally,
    // so this must be well above the expected final reply length.
    max_completion_tokens: 16000,
    // temperature is intentionally omitted — o3 is a reasoning model and
    // performs best at its default (1). Lowering it has no meaningful effect
    // on the chain-of-thought process.
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  }
    ]
  };

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new OpenAIError(res.status, err?.error?.message || 'Unknown OpenAI error');
    }

    const data   = await res.json();
    const text   = data.choices?.[0]?.message?.content?.trim();

    if (!text) throw new OpenAIError(0, 'Empty response from OpenAI');

    return {
      draft: text,
      model: MODEL,
      usage: data.usage || null,
    };

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new OpenAIError(408, `OpenAI timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw err; // re-throw OpenAIError or network errors
  }
}

export class OpenAIError extends Error {
  constructor(status, message) {
    super(message);
    this.name   = 'OpenAIError';
    this.status = status;
  }
}