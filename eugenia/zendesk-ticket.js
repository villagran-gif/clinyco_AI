export async function publishPrivateTicketNote({ zendeskSupportPut, ticketId, body }) {
  if (!ticketId) return null;
  return zendeskSupportPut(`/api/v2/tickets/${ticketId}.json`, {
    ticket: {
      comment: {
        body,
        public: false
      }
    }
  });
}

export function extractCommentEventsFromAudits(audits = []) {
  const normalized = [];
  for (const audit of Array.isArray(audits) ? audits : []) {
    const events = Array.isArray(audit?.events) ? audit.events : [];
    for (const event of events) {
      if (!["Comment", "VoiceComment", "ChatStartedEvent", "ChatEndedEvent"].includes(event?.type)) continue;
      normalized.push({
        auditId: String(audit?.id || ""),
        createdAt: audit?.created_at || null,
        authorId: audit?.author_id ? String(audit.author_id) : null,
        eventType: event?.type || null,
        sourcePublic: typeof event?.public === "boolean" ? event.public : null,
        body: event?.body || event?.plain_body || event?.html_body || null
      });
    }
  }
  return normalized;
}

export function isEugeniaInternalNote(body) {
  return String(body || "").includes("--- EugenIA (nota interna) ---");
}
