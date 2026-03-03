// ─── Freshservice REST API wrapper ────────────────────────────────────────────
// All calls are made from the background service worker, never the content script.

export class FreshserviceAPI {
  constructor({ subdomain, apiKey }) {
    this.base  = `https://${subdomain}.freshservice.com/api/v2`;
    // Basic auth: apiKey as username, "X" as password (FS convention)
    this.auth  = btoa(`${apiKey}:X`);
    this.headers = {
      'Authorization': `Basic ${this.auth}`,
      'Content-Type': 'application/json',
    };
  }

  async _get(path) {
    const res = await fetch(`${this.base}${path}`, {
      method: 'GET',
      headers: this.headers,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`FS API ${res.status}: ${text}`);
    }
    return res.json();
  }

  // Fetch core ticket data
  async getTicket(ticketId) {
    const data = await this._get(`/tickets/${ticketId}?include=requester`);
    return data.ticket;
  }

  // Fetch full conversation thread
  async getConversations(ticketId) {
    const data = await this._get(`/tickets/${ticketId}/conversations`);
    return data.conversations || [];
  }

  // Fetch attachment metadata list
  async getAttachments(ticketId) {
    // Attachments are embedded in ticket + conversations; we parse them out
    // This helper returns a flat array of { name, content_type, attachment_url }
    const [ticket, convos] = await Promise.all([
      this.getTicket(ticketId),
      this.getConversations(ticketId),
    ]);

    const attachments = [];

    (ticket.attachments || []).forEach(a => attachments.push(a));
    convos.forEach(c => {
      (c.attachments || []).forEach(a => attachments.push(a));
    });

    return attachments;
  }

  // Fetch all ticket data in one parallel call — primary method used by service worker
  async getFullTicketContext(ticketId) {
    const [ticket, conversations] = await Promise.all([
      this.getTicket(ticketId),
      this.getConversations(ticketId),
    ]);

    // Collect all attachments from ticket + thread
    const attachments = [];
    (ticket.attachments || []).forEach(a => attachments.push(a));
    conversations.forEach(c => {
      (c.attachments || []).forEach(a => attachments.push(a));
    });

    return { ticket, conversations, attachments };
  }

  // Fetch a single attachment as base64 (for image vision inputs)
  async fetchAttachmentAsBase64(url) {
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error(`Attachment fetch failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    let binary   = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }
}