// ─── OpenAI GPT-4o caller ─────────────────────────────────────────────────────
// Handles text + image (vision) inputs, with timeout and structured error info.

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL           = 'gpt-4o';
const TIMEOUT_MS      = 20000; // 20 seconds — generous for vision calls

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
        detail: 'low' // 'low' = faster + cheaper; 'high' for fine detail
      }
    });
  }

  const body = {
    model: MODEL,
    max_tokens: 1000,
    temperature: 0.4,    // Low temp = consistent, professional tone
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