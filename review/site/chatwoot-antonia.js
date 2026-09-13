(() => {
  const origin = 'https://app.chatwoot.com';
  window.addEventListener('message', event => {
    if (window.parent === window || event.origin !== origin || event.source !== window.parent) return;
    let message = event.data;
    try { if (typeof message === 'string') message = JSON.parse(message); } catch { return; }
    if (message?.event !== 'appContext') return;
    const conversation = message.data?.conversation;
    if (String(conversation?.account_id) !== '162472' || !/^[1-9]\d{0,15}$/.test(String(conversation?.id || ''))) return;
    document.getElementById('case-status').textContent = `Conversación #${conversation.id}`;
    document.getElementById('open-feedback').href = `https://clinyco-ai.netlify.app/antonia-feedback.html?conversation=${conversation.id}`;
  });
  if (window.parent !== window) window.parent.postMessage('chatwoot-dashboard-app:fetch-info', origin);
  else document.getElementById('case-status').textContent = 'Puedes enviar una sugerencia general.';
})();
