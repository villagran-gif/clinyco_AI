(() => {
  const $ = id => document.getElementById(id);
  const endpoint = '/api/antonia/improvements';
  const rawId = new URLSearchParams(location.search).get('conversation');
  const conversationId = /^[1-9]\d{0,15}$/.test(rawId || '') ? rawId : null;
  let requestId = crypto.randomUUID();
  let saving = false;
  let refreshing = false;
  const errorLabel = code => ({ ai_quota_exhausted: 'Pendiente de análisis: falta saldo de IA.', ai_rate_limited: 'Pendiente de análisis: límite temporal de IA.', ai_not_configured: 'Pendiente de análisis: IA sin configurar.', review_failed: 'El análisis falló y se intentará en la próxima revisión.' }[code] || 'Pendiente de revisión');
  const date = value => new Date(value).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' });
  const el = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
  function caseLink(id) {
    const link = el('a', `Conversación #${id}`);
    link.href = `https://app.chatwoot.com/app/accounts/162472/conversations/${id}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
  }
  if (conversationId) $('conversation-label').replaceChildren(caseLink(conversationId));
  function renderItem(item) {
    const card = el('article', '', 'suggestion');
    card.append(el('span', item.reviewed_at ? 'Analizada · propuesta para revisar' : errorLabel(item.review_error), 'badge'));
    card.append(el('p', item.problem));
    if (item.proposal) card.append(el('p', `Propuesta del agente: ${item.proposal}`));
    card.append(el('small', `${item.author_email} · ${date(item.created_at)}`));
    if (/^[1-9]\d{0,15}$/.test(item.conversation_id || '')) { card.append(el('p', '')); card.append(caseLink(item.conversation_id)); }
    if (item.analysis) {
      const analysis = el('div', '', 'analysis');
      analysis.append(el('strong', { factible: 'Factible', requiere_validacion: 'Requiere validación', no_recomendado: 'No recomendado' }[item.analysis.verdict] || 'Análisis'));
      analysis.append(el('p', item.analysis.reason), el('p', `Propuesta: ${item.analysis.proposal}`), el('p', `Antes de aplicar: ${item.analysis.checks}`));
      card.append(analysis);
    }
    return card;
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true; $('refresh-feedback').disabled = true;
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('load_failed');
      const data = await response.json();
      $('suggestions').replaceChildren(...(data.items.length ? data.items.map(renderItem) : [el('p', 'Todavía no hay sugerencias.')]));
      const blocked = data.lastRun?.error ? ` ${errorLabel(data.lastRun.error)}` : '';
      $('review-status').textContent = `${data.pending} pendientes. Próxima revisión: ${date(data.nextReviewAt)} (hora de Chile).${blocked}`;
    } catch { $('review-status').textContent = 'No se pudieron cargar las sugerencias. Pulsa Actualizar para reintentar.'; }
    finally { refreshing = false; $('refresh-feedback').disabled = false; }
  }
  $('feedback-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !$('feedback-form').reportValidity()) return;
    saving = true; $('save-feedback').disabled = true; $('save-status').textContent = 'Guardando…';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, conversationId, category: $('category').value, problem: $('problem').value, proposal: $('proposal').value }) });
      if (!response.ok) throw new Error('save_failed');
      $('feedback-form').reset(); requestId = crypto.randomUUID();
      $('save-status').textContent = 'Sugerencia guardada. Quedó pendiente de análisis.';
      await refresh();
    } catch { $('save-status').textContent = 'No se pudo confirmar el guardado. Conservamos tu texto; vuelve a intentarlo.'; }
    finally { saving = false; $('save-feedback').disabled = false; }
  });
  $('refresh-feedback').onclick = refresh;
  Promise.resolve(window.reviewAuthReady).then(ready => { if (ready) void refresh(); });
})();
