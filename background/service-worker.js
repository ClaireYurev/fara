// ─── Background Service Worker ────────────────────────────────────────────────
// Central brain. Receives messages from the content script, fetches ticket
// data, assembles the prompt, calls AI with fallback, returns draft to panel.

import { FreshserviceAPI }             from '../lib/freshservice-api.js';
import { buildSystemPrompt,
         buildUserPrompt, isImage }    from '../lib/prompt-builder.js';
import { callOpenAI, OpenAIError }     from '../lib/openai.js';
import { callGemini, GeminiError }     from '../lib/gemini.js';

const MAX_RETRIES = 1; // retry primary model once before falling back

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GENERATE_REPLY') {
    handleGenerateReply(message.ticketId, sender.tab, message.instruction || null)
      .then(result  => sendResponse({ success: true,  ...result }))
      .catch(error  => sendResponse({ success: false, error: error.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'OPEN_SIDE_PANEL') {
    chrome.sidePanel.open({ tabId: sender.tab.id });
    return false;
  }
});

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handleGenerateReply(ticketId, tab, instruction = null) {
  // 1. Load settings from storage
  const settings = await loadSettings();
  validateSettings(settings); // throws if misconfigured

  // 2. Fetch ticket data from Freshservice API
  let ticketContext;
  try {
    const api = new FreshserviceAPI({
      subdomain: settings.fsSubdomain,
      apiKey:    settings.fsApiKey,
    });
    ticketContext = await api.getFullTicketContext(ticketId);
  } catch (err) {
    // API failed — request DOM fallback from content script.
    // tab may be undefined when the request originates from the side panel
    // (sender.tab is only set for content script messages), so resolve lazily.
    console.warn('[AI Assistant] FS API failed, requesting DOM fallback:', err.message);
    const tabId = tab?.id ?? await getActiveTabId();
    if (tabId == null) throw new Error('FS API failed and no active tab found for DOM fallback.');
    ticketContext = await requestDOMFallback(tabId);
  }

  // 3. Fetch image attachments as base64 (up to 5 images to control cost)
  const imageAttachments = await fetchImageAttachments(ticketContext.attachments, settings);

  // 4. Build prompts
  const systemPrompt = buildSystemPrompt({
    companyName:        settings.companyName,
    customSystemPrompt: settings.systemPrompt,
    knowledgeBase:      settings.knowledgeBase,
  });

  const userPrompt = buildUserPrompt(ticketContext)
  + (instruction ? `\n\n--- ADDITIONAL INSTRUCTION ---\n${instruction}` : '');

  // 5. Call AI (primary → retry → fallback)
  const result = await callWithFallback({
    settings,
    systemPrompt,
    userPrompt,
    imageAttachments,
  });

  // 6. Cache the draft keyed by ticketId for the side panel to retrieve
  await chrome.storage.session.set({
    [`draft_${ticketId}`]: {
      ...result,
      ticketId,
      ticketSubject: ticketContext.ticket?.subject || '',
      requesterName: getRequesterFirstName(ticketContext.ticket),
      generatedAt:   new Date().toISOString(),
    }
  });

  return result;
}

// ─── AI call with retry + fallback ───────────────────────────────────────────
async function callWithFallback({ settings, systemPrompt, userPrompt, imageAttachments }) {
  const primary   = settings.primaryModel === 'gemini' ? 'gemini' : 'openai';
  const secondary = primary === 'openai' ? 'gemini' : 'openai';

  // Attempt primary (with one retry on failure)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callModel(primary, { settings, systemPrompt, userPrompt, imageAttachments });
      return { ...result, usedFallback: false };
    } catch (err) {
      console.warn(`[AI Assistant] ${primary} attempt ${attempt + 1} failed:`, err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * (attempt + 1)); // brief back-off before retry
      }
    }
  }

  // Primary exhausted — try fallback
  console.warn(`[AI Assistant] Falling back to ${secondary}`);
  try {
    const result = await callModel(secondary, { settings, systemPrompt, userPrompt, imageAttachments });
    return { ...result, usedFallback: true, fallbackModel: secondary };
  } catch (err) {
    // Both models failed
    throw new Error(
      `Both AI models failed. Last error (${secondary}): ${err.message}`
    );
  }
}

// ─── Call a specific model by name ───────────────────────────────────────────
async function callModel(modelName, { settings, systemPrompt, userPrompt, imageAttachments }) {
  if (modelName === 'openai') {
    if (!settings.openaiKey) throw new OpenAIError(0, 'No OpenAI API key configured');
    return callOpenAI({
      apiKey:           settings.openaiKey,
      systemPrompt,
      userPrompt,
      imageAttachments,
    });
  }

  if (modelName === 'gemini') {
    if (!settings.geminiKey) throw new GeminiError(0, 'No Gemini API key configured');
    return callGemini({
      apiKey:           settings.geminiKey,
      systemPrompt,
      userPrompt,
      imageAttachments,
    });
  }

  throw new Error(`Unknown model: ${modelName}`);
}

// ─── Fetch image attachments as base64 ────────────────────────────────────────
async function fetchImageAttachments(attachments, settings) {
  if (!attachments || attachments.length === 0) return [];

  const imageFiles = attachments
    .filter(a => isImage(a.content_type))
    .slice(0, 5); // cap at 5 images to control token cost

  const api = new FreshserviceAPI({
    subdomain: settings.fsSubdomain,
    apiKey:    settings.fsApiKey,
  });

  const results = await Promise.allSettled(
    imageFiles.map(async (att) => {
      const base64 = await api.fetchAttachmentAsBase64(att.attachment_url);
      return { contentType: att.content_type, base64, name: att.name };
    })
  );

  // Only return images that fetched successfully — skip failures silently
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

// ─── Resolve the active tab ID (used when sender.tab is undefined, e.g. side panel) ──
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

// ─── Request DOM fallback from content script ─────────────────────────────────
function requestDOMFallback(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'DOM_FALLBACK_REQUEST' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error('Content script unreachable: ' + chrome.runtime.lastError.message));
        return;
      }
      if (response?.success) {
        resolve(response.ticketContext);
      } else {
        reject(new Error(response?.error || 'DOM fallback failed'));
      }
    });
  });
}

// ─── Settings helpers ─────────────────────────────────────────────────────────
async function loadSettings() {
  return chrome.storage.local.get([
    'fsSubdomain', 'fsApiKey',
    'openaiKey',   'geminiKey',
    'primaryModel','companyName',
    'systemPrompt','knowledgeBase',
  ]);
}

function validateSettings(s) {
  if (!s.fsSubdomain) throw new Error('Freshservice subdomain not configured. Open Settings.');
  if (!s.fsApiKey)    throw new Error('Freshservice API key not configured. Open Settings.');
  if (!s.openaiKey && !s.geminiKey)
    throw new Error('No AI API keys configured. Add at least one in Settings.');
}

// ─── Utility helpers ──────────────────────────────────────────────────────────
function getRequesterFirstName(ticket) {
  if (!ticket?.requester) return '';
  return ticket.requester.first_name || ticket.requester.name?.split(' ')[0] || '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Open side panel when extension icon is clicked ───────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Keep service worker from being killed mid-request ────────────────────────
// MV3 service workers can be terminated; this ping keeps it alive during generation
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    port.onDisconnect.addListener(() => {});
  }
});