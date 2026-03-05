// ─── Side Panel ───────────────────────────────────────────────────────────────
// Handles all UI state: idle → loading → draft (or error).
// Communicates with the content script to insert text into the reply box.

(function () {
  'use strict';

  // ── Element refs ─────────────────────────────────────────────────────────────
  const states = {
    idle:    document.getElementById('state-idle'),
    loading: document.getElementById('state-loading'),
    error:   document.getElementById('state-error'),
    draft:   document.getElementById('state-draft'),
  };

  const el = {
    ticketBar:       document.getElementById('ticket-bar'),
    ticketIdLabel:   document.getElementById('ticket-id-label'),
    ticketSubject:   document.getElementById('ticket-subject-label'),
    modelBadge:      document.getElementById('model-badge'),
    loadingModelLbl: document.getElementById('loading-model-label'),
    errorMessage:    document.getElementById('error-message'),
    draftTextarea:   document.getElementById('draft-textarea'),
    insertBtn:       document.getElementById('insert-btn'),
    copyBtn:         document.getElementById('copy-btn'),
    clearBtn:        document.getElementById('clear-btn'),
    regenBtn:        document.getElementById('regen-btn'),
    regenInput:      document.getElementById('regen-instruction'),
    retryBtn:        document.getElementById('retry-btn'),
    settingsBtn:     document.getElementById('settings-btn'),
    statusBar:       document.getElementById('status-bar'),
  };

  // ── App state ─────────────────────────────────────────────────────────────────
  let currentTicketId   = null;
  let lastSettings      = null;

  // ── Init ──────────────────────────────────────────────────────────────────────
  init();

  async function init() {
    bindEvents();
    showState('idle');

    // Check if there's already a draft waiting (e.g. panel was closed and reopened)
    await checkForExistingDraft();
  }

  // ── Event bindings ────────────────────────────────────────────────────────────
  function bindEvents() {

    el.insertBtn.addEventListener('click', handleInsert);
    el.copyBtn.addEventListener('click',   handleCopy);
    el.clearBtn.addEventListener('click',  handleClear);
    el.regenBtn.addEventListener('click',  handleRegenerate);
    el.retryBtn.addEventListener('click',  handleRetry);
    el.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

    // Allow Cmd+Enter / Ctrl+Enter in textarea to trigger insert
    el.draftTextarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleInsert();
      }
    });

    // Listen for messages from content script + service worker
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // ── Message handler (from content script) ────────────────────────────────────
  function handleMessage(message) {
    if (message.type === 'DRAFT_READY') {
      currentTicketId = message.ticketId;
      renderDraft({
        draft:        message.draft,
        model:        message.model,
        usedFallback: message.usedFallback,
        ticketId:     message.ticketId,
      });
    }

    if (message.type === 'GENERATION_STARTED') {
      currentTicketId = message.ticketId;
      showState('loading');
      const primaryModel = message.primaryModel === 'gemini' ? 'Gemini 2.0 Flash' : 'GPT-4o';
      el.loadingModelLbl.textContent = `Contacting ${primaryModel}…`;
    }

    if (message.type === 'GENERATION_FAILED') {
      showState('error');
      el.errorMessage.textContent = message.error || 'Unknown error occurred.';
    }
  }

  // ── Check for draft already in session storage ────────────────────────────────
  async function checkForExistingDraft() {
    // Get the active tab to find the current ticket ID
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const match = tab.url?.match(/\/a\/tickets\/(\d+)/);
    if (!match) return;

    const ticketId = match[1];
    const key      = `draft_${ticketId}`;

    const stored = await chrome.storage.session.get(key);
    if (stored[key]) {
      currentTicketId = ticketId;
      renderDraft(stored[key]);
    }
  }

  // ── Render a completed draft ──────────────────────────────────────────────────
  function renderDraft({ draft, model, usedFallback, ticketId, ticketSubject }) {
    el.draftTextarea.value = draft || '';

    // Ticket bar
    if (ticketId) {
      el.ticketIdLabel.textContent  = `#${ticketId}`;
      el.ticketSubject.textContent  = ticketSubject || '';
      el.ticketBar.classList.remove('hidden');
    }

    // Model badge
    const isGemini   = model?.includes('gemini') || usedFallback;
    const badgeText  = usedFallback
      ? `Gemini (fallback)`
      : model?.includes('gemini') ? 'Gemini 2.0 Flash' : 'GPT-4o';
    const badgeClass = usedFallback ? 'fallback' : isGemini ? 'gemini' : 'openai';

    el.modelBadge.textContent = badgeText;
    el.modelBadge.className   = `badge ${badgeClass}`;

    showState('draft');
    setStatus('Draft ready — review and insert when ready.', 'success', 4000);
  }

  // ── Insert draft into reply box ───────────────────────────────────────────────
  async function handleInsert() {
    const text = el.draftTextarea.value.trim();
    if (!text) {
      setStatus('Draft is empty — nothing to insert.', 'warning');
      return;
    }

    el.insertBtn.disabled = true;
    el.insertBtn.textContent = '↵ Inserting…';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active tab found.');

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'INSERT_REPLY',
        text: text,
      });

      if (response?.success) {
        setStatus('✅ Reply inserted — review before sending.', 'success', 6000);
      } else {
        setStatus(`⚠️ ${response?.error || 'Insert failed.'}`, 'warning', 0);
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error', 0);
    } finally {
      el.insertBtn.disabled    = false;
      el.insertBtn.textContent = '↵ Insert into Reply Box';
    }
  }

  // ── Copy draft to clipboard ───────────────────────────────────────────────────
  async function handleCopy() {
    const text = el.draftTextarea.value.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      el.copyBtn.textContent = '✓';
      setStatus('Copied to clipboard.', 'success', 2000);
      setTimeout(() => { el.copyBtn.textContent = '⧉'; }, 1500);
    } catch {
      setStatus('Copy failed — try selecting and copying manually.', 'warning');
    }
  }

  // ── Clear draft ───────────────────────────────────────────────────────────────
  function handleClear() {
    el.draftTextarea.value = '';
    el.regenInput.value    = '';
    el.ticketBar.classList.add('hidden');
    showState('idle');
    setStatus('');

    // Remove from session cache
    if (currentTicketId) {
      chrome.storage.session.remove(`draft_${currentTicketId}`);
      currentTicketId = null;
    }
  }

  // ── Regenerate ────────────────────────────────────────────────────────────────
  async function handleRegenerate() {
    if (!currentTicketId) {
      setStatus('No active ticket to regenerate for.', 'warning');
      return;
    }

    const instruction = el.regenInput.value.trim();

    el.regenBtn.disabled    = true;
    el.regenBtn.textContent = '↺ Regenerating…';
    showState('loading');

    const settings     = await loadSettings();
    const primaryModel = settings?.primaryModel === 'gemini' ? 'Gemini 2.0 Flash' : 'GPT-4o';
    el.loadingModelLbl.textContent = `Contacting ${primaryModel}…`;

    try {
      const response = await chrome.runtime.sendMessage({
        type:        'GENERATE_REPLY',
        ticketId:    currentTicketId,
        instruction: instruction || null, // passed to service worker for prompt injection
      });

      if (response?.success) {
        renderDraft({
          draft:        response.draft,
          model:        response.model,
          usedFallback: response.usedFallback,
          ticketId:     currentTicketId,
        });
      } else {
        showState('error');
        el.errorMessage.textContent = response?.error || 'Regeneration failed.';
      }
    } catch (err) {
      showState('error');
      el.errorMessage.textContent = err.message;
    } finally {
      el.regenBtn.disabled    = false;
      el.regenBtn.textContent = '↺ Regenerate';
    }
  }

  // ── Retry (from error state) ──────────────────────────────────────────────────
  async function handleRetry() {
    if (!currentTicketId) {
      showState('idle');
      return;
    }
    showState('loading');
    try {
      const response = await chrome.runtime.sendMessage({
        type:     'GENERATE_REPLY',
        ticketId: currentTicketId,
      });
      if (response?.success) {
        renderDraft({
          draft:        response.draft,
          model:        response.model,
          usedFallback: response.usedFallback,
          ticketId:     currentTicketId,
        });
      } else {
        showState('error');
        el.errorMessage.textContent = response?.error || 'Retry failed.';
      }
    } catch (err) {
      showState('error');
      el.errorMessage.textContent = err.message;
    }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  function showState(name) {
    Object.entries(states).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== name);
    });
  }

  function setStatus(msg, type = '', durationMs = 3000) {
    el.statusBar.textContent = msg;
    el.statusBar.className   = `status-bar ${type}`;
    if (durationMs > 0 && msg) {
      setTimeout(() => {
        el.statusBar.textContent = '';
        el.statusBar.className   = 'status-bar';
      }, durationMs);
    }
  }

  async function loadSettings() {
    return chrome.storage.local.get(['primaryModel']);
  }

})();