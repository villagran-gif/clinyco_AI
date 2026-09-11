import test from "node:test";
import assert from "node:assert/strict";
import { contactEvent, displayName, initials, publicLinks, recordContactEvent, linkVerifiedRecord } from "../review/crm-links.js";

const event = () => ({ event: "message_created", account: { id: 162472 }, id: 99,
  message_type: "incoming", created_at: 1789052400,
  sender: { id: 123, name: "María Elena Ejemplo", phone_number: "+56900000000" },
  content: "Información sensible", conversation: { id: 456 } });

test("projects only initials and destination links, never raw patient fields", () => {
  const result = publicLinks({ contact_id: "123", initials: "M. E. E.", conversation_ids: ["456", "456", "javascript:alert(1)"],
    medinet_id: "789", medinet_section: "1", verified_at: new Date(), rut: "12345678-5", name: "María Elena Ejemplo", content: "secret" });
  assert.deepEqual(Object.keys(result), ["contact", "conversations", "record"]);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.record.url, "https://clinyco.medinetapp.com/pacientes/ficha/789/1/");
  assert.doesNotMatch(JSON.stringify(result), /12345678|María|secret/);
  assert.equal(publicLinks({ contact_id: "1", initials: "Full name", medinet_id: "2", medinet_section: "1" }).record, null);
  assert.equal(publicLinks({ contact_id: "1", initials: "Full name" }).contact.text, "S. I.");
});

test("incoming and outgoing events identify the contact rather than the agent", () => {
  assert.equal(contactEvent(event()).initials, "M. E. E.");
  const outgoing = { ...event(), message_type: "outgoing", sender: { id: 7, name: "Agente" },
    conversation: { id: 456, meta: { sender: event().sender } } };
  assert.equal(contactEvent(outgoing).contactId, "123");
  assert.equal(contactEvent({ ...event(), private: true }), null);
  assert.equal(contactEvent({ ...event(), account: { id: 1 } }), null);
  assert.equal(contactEvent({ ...outgoing, conversation: { id: 456 } }), null);
  assert.equal(initials("12345678 +56900000000"), "S. I.");
});

test("writes transactionally and rolls back on a conversation write failure", async () => {
  const queries = [];
  const client = { query: async sql => { queries.push(sql); if (sql.includes("INSERT INTO crm_link_conversations")) throw new Error("DB unavailable"); return {}; }, release() { queries.push("release"); } };
  const pool = { query: async () => ({}), connect: async () => client };
  await assert.rejects(recordContactEvent(pool, event()), /DB unavailable/);
  assert.equal(queries[0], "BEGIN");
  assert.deepEqual(queries.slice(-2), ["ROLLBACK", "release"]);
});

test("verified mapping normalizes valid RUT and refuses invalid check digit before writes", async () => {
  let params;
  const pool = { query: async (sql, values) => { if (values) params = values; return { rowCount: 1 }; } };
  await linkVerifiedRecord(pool, { contactId: "123", rut: "12.345.678-5", medinetId: "789", section: "1" });
  assert.equal(params[1], "123456785");
  await assert.rejects(linkVerifiedRecord(pool, { contactId: "123", rut: "12345678K", medinetId: "789", section: "1" }), /Invalid/);
});

 test("authenticated links show the supplied name with initials fallback", () => {
  assert.equal(publicLinks({contact_id:"123",display_name:"María Elena Ejemplo",initials:"M. E. E."}).contact.text,"María Elena Ejemplo");
  assert.equal(contactEvent(event()).displayName,"María Elena Ejemplo");
  assert.equal(displayName("  María\n Elena  "),"María Elena");
  assert.equal(displayName({name:"invalid"}),null);
  assert.equal(displayName("   "),null);
 });
