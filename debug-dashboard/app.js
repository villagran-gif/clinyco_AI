const tbody = document.getElementById("tbody");
const detail = document.getElementById("detail");
const loadBtn = document.getElementById("loadBtn");

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function fetchJson(url, key) {
  const res = await fetch(url, {
    headers: { "x-debug-key": key }
  });
  return res.json();
}

function buildDuplicateMaps(events) {
  const inbound = new Map();
  const outbound = new Map();

  events.forEach((event, index) => {
    if (event.user_text) {
      const key = `${event.conversation_id}::${normalizeText(event.user_text)}`;
      const bucket = inbound.get(key) || [];
      bucket.push(index);
      inbound.set(key, bucket);
    }
    if (event.bot_reply) {
      const key = `${event.conversation_id}::${normalizeText(event.bot_reply)}`;
      const bucket = outbound.get(key) || [];
      bucket.push(index);
      outbound.set(key, bucket);
    }
  });

  return { inbound, outbound };
}

function hasNearDuplicate(events, indexes, currentIndex) {
  if (!indexes || indexes.length < 2) return false;
  const currentTime = new Date(events[currentIndex].created_at).getTime();
  return indexes.some((index) => {
    if (index === currentIndex) return false;
    const comparedTime = new Date(events[index].created_at).getTime();
    return Math.abs(currentTime - comparedTime) <= 3000;
  });
}

function badge(label, tone = "neutral") {
  return `<span class="badge badge-${tone}">${esc(label)}</span>`;
}

function reasonTone(reason = "", stage = "") {
  const text = `${reason} ${stage}`.toLowerCase();
  if (text.includes("duplicate")) return "warn";
  if (text.includes("human_business_message_detected") || text.includes("ticket_assigned")) return "danger";
  if (text.includes("unknown_professional_schedule") || text.includes("ai_disabled") || text.includes("max_bot_messages")) return "warn";
  return "neutral";
}

function renderRows(events) {
  tbody.innerHTML = "";
  const duplicateMaps = buildDuplicateMaps(events);

  events.forEach((e, index) => {
    const inboundKey = `${e.conversation_id}::${normalizeText(e.user_text)}`;
    const outboundKey = `${e.conversation_id}::${normalizeText(e.bot_reply)}`;
    const duplicateInbound = e.user_text && hasNearDuplicate(events, duplicateMaps.inbound.get(inboundKey), index);
    const duplicateOutbound = e.bot_reply && hasNearDuplicate(events, duplicateMaps.outbound.get(outboundKey), index);
    const flags = [
      duplicateInbound ? badge("dup inbound", "warn") : "",
      duplicateOutbound ? badge("dup outbound", "danger") : "",
      e.reason ? badge(e.reason, reasonTone(e.reason, e.stage)) : ""
    ].filter(Boolean).join(" ");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(new Date(e.created_at).toLocaleString())}</td>
      <td>${esc(e.channel)}</td>
      <td>${esc(e.user_name)}</td>
      <td>${esc(e.stage)}</td>
      <td>${esc(e.next_action)}</td>
      <td>${esc(e.bot_messages_sent)}</td>
      <td>${flags}</td>
      <td>${esc(e.user_text)}</td>
      <td>${esc(e.bot_reply)}</td>
    `;
    tr.onclick = () => {
      detail.textContent = JSON.stringify(e, null, 2);
    };
    tbody.appendChild(tr);
  });
}

loadBtn.onclick = async () => {
  const baseUrl = document.getElementById("baseUrl").value.trim().replace(/\/$/, "");
  const debugKey = document.getElementById("debugKey").value.trim();
  const conversationId = document.getElementById("conversationId").value.trim();

  if (!baseUrl || !debugKey) {
    alert("Falta baseUrl o debugKey");
    return;
  }

  let url = `${baseUrl}/debug/events?limit=50`;
  if (conversationId) {
    url = `${baseUrl}/debug/conversation/${encodeURIComponent(conversationId)}`;
  }

  const data = await fetchJson(url, debugKey);
  if (!data.ok) {
    alert(data.error || "Error");
    return;
  }

  renderRows(data.events || []);
};
