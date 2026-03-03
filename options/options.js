// ─── secrets.json loader ──────────────────────────────────────────────────────
const FIELD_MAP = {
  fsSubdomain:   'fs-subdomain',
  fsApiKey:      'fs-api-key',
  openaiKey:     'openai-key',
  geminiKey:     'gemini-key',
  primaryModel:  'primary-model',
  companyName:   'company-name',
  systemPrompt:  'system-prompt',
  knowledgeBase: 'knowledge-base',
};

document.getElementById('load-secrets-btn').addEventListener('click', () => {
  document.getElementById('secrets-file').click();
});

document.getElementById('secrets-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const secrets = JSON.parse(event.target.result);
      let loaded = 0;

      for (const [key, elementId] of Object.entries(FIELD_MAP)) {
        if (secrets[key] !== undefined) {
          document.getElementById(elementId).value = secrets[key];
          loaded++;
        }
      }

      showStatus(`✅ Loaded ${loaded} value(s) from secrets.json — click Save to apply`, 'success');
    } catch (err) {
      showStatus(`❌ Invalid JSON: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);

  // Reset input so the same file can be re-loaded if needed
  e.target.value = '';
});

// ─── Load saved settings into the form ───────────────────────────────────────
async function loadSettings() {
  const keys = [
    'fsSubdomain', 'fsApiKey',
    'openaiKey', 'geminiKey',
    'primaryModel', 'companyName',
    'systemPrompt', 'knowledgeBase'
  ];

  const data = await chrome.storage.local.get(keys);

  document.getElementById('fs-subdomain').value  = data.fsSubdomain  || '';
  document.getElementById('fs-api-key').value    = data.fsApiKey     || '';
  document.getElementById('openai-key').value    = data.openaiKey    || '';
  document.getElementById('gemini-key').value    = data.geminiKey    || '';
  document.getElementById('primary-model').value = data.primaryModel || 'openai';
  document.getElementById('company-name').value  = data.companyName  || '';
  document.getElementById('system-prompt').value = data.systemPrompt || '';
  document.getElementById('knowledge-base').value= data.knowledgeBase|| '';
}

// ─── Save settings from the form ─────────────────────────────────────────────
async function saveSettings() {
  const settings = {
    fsSubdomain:   document.getElementById('fs-subdomain').value.trim(),
    fsApiKey:      document.getElementById('fs-api-key').value.trim(),
    openaiKey:     document.getElementById('openai-key').value.trim(),
    geminiKey:     document.getElementById('gemini-key').value.trim(),
    primaryModel:  document.getElementById('primary-model').value,
    companyName:   document.getElementById('company-name').value.trim(),
    systemPrompt:  document.getElementById('system-prompt').value.trim(),
    knowledgeBase: document.getElementById('knowledge-base').value.trim(),
  };

  // Basic validation
  const missing = [];
  if (!settings.fsSubdomain) missing.push('Freshservice subdomain');
  if (!settings.fsApiKey)    missing.push('Freshservice API key');
  if (!settings.openaiKey && !settings.geminiKey)
    missing.push('at least one AI key (OpenAI or Gemini)');

  if (missing.length) {
    showStatus(`⚠️ Missing: ${missing.join(', ')}`, 'error');
    return;
  }

  await chrome.storage.local.set(settings);
  showStatus('✅ Settings saved!', 'success');
}

// ─── KB file upload handler ───────────────────────────────────────────────────
document.getElementById('kb-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    document.getElementById('knowledge-base').value = event.target.result;
  };
  reader.readAsText(file);
});

// ─── Status message helper ────────────────────────────────────────────────────
function showStatus(msg, type = 'success') {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.className = `status ${type}`;
  setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', saveSettings);
loadSettings();