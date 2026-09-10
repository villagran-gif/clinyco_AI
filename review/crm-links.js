import { normalizeRut } from "../extraction/identity-normalizers.js";

const digits = value => /^\d+$/.test(String(value ?? "")) ? String(value) : null;
export function initials(name) {
  return String(name || "").match(/\p{L}[\p{L}\p{M}]*/gu)?.slice(0, 5)
    .map(word => `${word[0].toLocaleUpperCase("es")}.`).join(" ") || "S. I.";
}

export function contactEvent(payload) {
  if (String(payload?.account?.id) !== "162472" || payload.event !== "message_created"
    || [true, "true", 1].includes(payload.private)
    || !["incoming", "outgoing", 0, 1].includes(payload.message_type)) return null;
  const incoming = ["incoming", 0].includes(payload.message_type);
  // Outgoing sender is the agent, never the contact.
  const sender = incoming ? payload.sender : payload.conversation?.meta?.sender;
  const contactId = digits(sender?.id);
  const conversationId = digits(payload.conversation?.id);
  const stamp = payload.created_at;
  const occurred = new Date(typeof stamp === "number" || /^\d{10}(?:\.\d+)?$/.test(String(stamp)) ? Number(stamp) * 1000 : stamp);
  if (!contactId || !conversationId || !Number.isFinite(occurred.getTime())) return null;
  return { contactId, conversationId, initials: initials(sender?.name), occurred };
}

// Strict allowlist: raw rows, names, RUTs, and message bodies never reach the client.
export function publicLinks(row) {
  const contactId = digits(row.contact_id);
  if (!contactId) return null;
  const label = /^(?:\p{L}\. ?){1,5}$/u.test(row.initials || "") ? row.initials : "S. I.";
  const link = url => ({ text: label, url });
  return {
    contact: link(`https://app.chatwoot.com/app/accounts/162472/contacts/${contactId}`),
    conversations: [...new Set(row.conversation_ids || [])].filter(digits)
      .map(id => link(`https://app.chatwoot.com/app/accounts/162472/conversations/${id}`)),
    record: row.verified_at && digits(row.medinet_id) && digits(row.medinet_section)
      ? link(`https://clinyco.medinetapp.com/pacientes/ficha/${row.medinet_id}/${row.medinet_section}/`) : null,
  };
}

const schema = `
CREATE TABLE IF NOT EXISTS crm_link_contacts (
  contact_id text PRIMARY KEY CHECK (contact_id ~ '^[0-9]+$'),
  initials text NOT NULL,
  last_seen timestamptz NOT NULL,
  rut_normalized text,
  medinet_id text,
  medinet_section text,
  verified_at timestamptz
);
CREATE TABLE IF NOT EXISTS crm_link_conversations (
  conversation_id text PRIMARY KEY CHECK (conversation_id ~ '^[0-9]+$'),
  contact_id text NOT NULL REFERENCES crm_link_contacts(contact_id),
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_link_activity (
  contact_id text NOT NULL REFERENCES crm_link_contacts(contact_id),
  activity_day date NOT NULL,
  PRIMARY KEY (contact_id, activity_day)
);
CREATE INDEX IF NOT EXISTS crm_link_activity_date ON crm_link_activity(activity_day, contact_id);
`;
const initialized = new WeakMap();
export async function ensureLinks(pool) {
  if (!pool) throw new Error("CRM database unavailable");
  if (!initialized.has(pool)) initialized.set(pool, pool.query(schema).catch(error => {
    initialized.delete(pool); throw error;
  }));
  await initialized.get(pool);
}

export async function recordContactEvent(pool, payload) {
  const event = contactEvent(payload);
  if (!event) return false;
  await ensureLinks(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO crm_link_contacts(contact_id, initials, last_seen) VALUES ($1,$2,$3)
      ON CONFLICT (contact_id) DO UPDATE SET
      initials=CASE WHEN EXCLUDED.last_seen >= crm_link_contacts.last_seen THEN EXCLUDED.initials ELSE crm_link_contacts.initials END,
      last_seen=GREATEST(crm_link_contacts.last_seen, EXCLUDED.last_seen)`, [event.contactId,event.initials,event.occurred]);
    await client.query(`INSERT INTO crm_link_conversations(conversation_id,contact_id,first_seen,last_seen) VALUES ($1,$2,$3,$3)
      ON CONFLICT(conversation_id) DO UPDATE SET contact_id=EXCLUDED.contact_id,
      first_seen=LEAST(crm_link_conversations.first_seen,EXCLUDED.first_seen),last_seen=GREATEST(crm_link_conversations.last_seen,EXCLUDED.last_seen)`,
      [event.conversationId,event.contactId,event.occurred]);
    await client.query(`INSERT INTO crm_link_activity(contact_id,activity_day)
      VALUES ($1,($2::timestamptz AT TIME ZONE 'America/Santiago')::date) ON CONFLICT DO NOTHING`, [event.contactId,event.occurred]);
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return true;
}

export async function listLinks(pool, month, offset = 0) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  await ensureLinks(pool);
  const { rows } = await pool.query(`SELECT c.initials,c.contact_id,c.medinet_id,c.medinet_section,c.verified_at,
    ARRAY(SELECT conversation_id FROM crm_link_conversations v WHERE v.contact_id=c.contact_id ORDER BY last_seen DESC) conversation_ids
    FROM crm_link_contacts c WHERE EXISTS (SELECT 1 FROM crm_link_activity a WHERE a.contact_id=c.contact_id
      AND a.activity_day >= $1::date AND a.activity_day < ($1::date + interval '1 month'))
    ORDER BY c.last_seen DESC,c.contact_id LIMIT 100 OFFSET $2`, [`${month}-01`,offset]);
  return rows.map(publicLinks).filter(Boolean);
}

// Internal only: the operator supplies a verified contact-to-RUT-to-Medinet mapping.
// Duplicate RUT contacts are retained; never automatically merge a clinical record.
export async function linkVerifiedRecord(pool, { contactId, rut, medinetId, section }) {
  const normalized = normalizeRut(rut);
  if (!normalized || !digits(contactId) || !digits(medinetId) || !digits(section)) throw new Error("Invalid verified mapping");
  await ensureLinks(pool);
  const result = await pool.query(`UPDATE crm_link_contacts SET rut_normalized=$2,medinet_id=$3,medinet_section=$4,verified_at=now()
    WHERE contact_id=$1`, [String(contactId),normalized.replace("-",""),String(medinetId),String(section)]);
  if (result.rowCount !== 1) throw new Error("Contact not imported");
}
