// ─── Google Gemini 1.5 Pro caller ─────────────────────────────────────────────
// Used as fallback when OpenAI fails. Same input contract as openai.js.

const MODEL        = 'gemini-1.5-pro';
const TIMEOUT_MS   = 25000; // Gemini can be slightly slower

function getEndpoint(apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
}

export async function callGemini({ apiKey, systemPrompt, userPrompt, imageAttachments = [] }) {
  // Gemini uses a single "parts" array; combine text + images
  const parts = [
    { text: `${systemPrompt}\n\n${userPrompt}` }
  ];

  const images = imageAttachments.slice(0, 10);
  for (const img of images) {
    parts.push({
      inline_data: {
        mime_type: img.contentType,
        data:      img.base64,
      }
    });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature:     0.4,
      maxOutputTokens: 1000,
    },
    safetySettings: [
      // Relax safety filters slightly for IT content (avoids false blocks on
      // technical terms that trigger harassment/dangerous filters)
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ]
  };

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(getEndpoint(apiKey), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new GeminiError(res.status, err?.error?.message || 'Unknown Gemini error');
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!text) {
      const reason = data.candidates?.[0]?.finishReason || 'unknown';
      throw new GeminiError(0, `Empty Gemini response (finishReason: ${reason})`);
    }

    return {
      draft: text,
      model: MODEL,
      usage: data.usageMetadata || null,
    };

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new GeminiError(408, `Gemini timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}

export class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.name   = 'GeminiError';
    this.status = status;
  }
}