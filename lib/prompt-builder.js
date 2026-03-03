// ─── Prompt Builder ───────────────────────────────────────────────────────────
// Assembles the full structured prompt from ticket data + settings.
// Kept separate so it's easy to tune prompts without touching AI call logic.

const DEFAULT_SYSTEM_PROMPT = `You are a Tier 1 IT support technician at {company}.
Your job is to write a professional, empathetic, and technically accurate reply to the support ticket below.

Rules:
- Address the requester by their first name
- Be concise — no unnecessary filler or corporate fluff
- If the issue is clearly described, provide actionable next steps
- If the issue is ambiguous, ask exactly ONE targeted clarifying question — do not guess
- Never promise specific timelines you cannot guarantee
- Never say "I hope this email finds you well" or similar openers
- Sign off with your name as "IT Support Team"
- Output ONLY the reply text — no preamble, no explanation, no subject line`;

export function buildSystemPrompt({ companyName, customSystemPrompt, knowledgeBase }) {
  let system = customSystemPrompt
    ? customSystemPrompt
    : DEFAULT_SYSTEM_PROMPT.replace('{company}', companyName || 'your company');

  if (knowledgeBase && knowledgeBase.trim()) {
    system += `\n\n--- INTERNAL KNOWLEDGE BASE / SOPs ---\n${knowledgeBase.trim()}\n--- END KB ---`;
  }

  return system;
}

export function buildUserPrompt({ ticket, conversations, attachments }) {
  const lines = [];

  // ── Ticket metadata ──
  lines.push(`TICKET #${ticket.id}`);
  lines.push(`Subject:   ${ticket.subject || '(no subject)'}`);

  const req = ticket.requester || {};
  const requesterName = [req.first_name, req.last_name].filter(Boolean).join(' ') || 'Unknown';
  lines.push(`Requester: ${requesterName} <${req.email || 'no email'}>`);
  lines.push(`Priority:  ${priorityLabel(ticket.priority)}`);
  lines.push(`Category:  ${ticket.category || 'Uncategorized'} / ${ticket.sub_category || ''}`);
  lines.push(`Status:    ${statusLabel(ticket.status)}`);
  lines.push(`Created:   ${formatDate(ticket.created_at)}`);
  lines.push('');

  // ── Ticket description ──
  lines.push('--- ORIGINAL REQUEST ---');
  lines.push(stripHtml(ticket.description_text || ticket.description || '(no description)'));
  lines.push('');

  // ── Conversation thread ──
  if (conversations && conversations.length > 0) {
    lines.push('--- CONVERSATION THREAD (oldest → newest) ---');
    conversations
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .forEach((c, i) => {
        const author = c.from_email || (c.user_id ? `Agent #${c.user_id}` : 'Unknown');
        const date   = formatDate(c.created_at);
        const body   = stripHtml(c.body_text || c.body || '(empty)');
        lines.push(`[${i + 1}] ${author} — ${date}`);
        lines.push(body);
        lines.push('');
      });
  }

  // ── Non-image attachment names (images are passed separately as vision inputs) ──
  const nonImageAttachments = (attachments || []).filter(a => !isImage(a.content_type));
  if (nonImageAttachments.length > 0) {
    lines.push('--- NON-IMAGE ATTACHMENTS (names only) ---');
    nonImageAttachments.forEach(a => lines.push(`• ${a.name} (${a.content_type})`));
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isImage(contentType) {
  if (!contentType) return false;
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
    .includes(contentType.toLowerCase());
}

function stripHtml(html) {
  // Remove tags, decode common entities, trim whitespace
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatDate(iso) {
  if (!iso) return 'Unknown';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function priorityLabel(n) {
  return { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' }[n] || `${n}`;
}

function statusLabel(n) {
  return { 2: 'Open', 3: 'Pending', 4: 'Resolved', 5: 'Closed' }[n] || `${n}`;
}