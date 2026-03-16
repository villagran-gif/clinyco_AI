const tbody = document.getElementById("tbody");
const detail = document.getElementById("detail");
const loadBtn = document.getElementById("loadBtn");

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

function renderRows(events) {
  tbody.innerHTML = "";
  events.forEach((e) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(new Date(e.created_at).toLocaleString())}</td>
      <td>${esc(e.channel)}</td>
      <td>${esc(e.user_name)}</td>
      <td>${esc(e.stage)}</td>
      <td>${esc(e.next_action)}</td>
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
