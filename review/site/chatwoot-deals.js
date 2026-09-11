(() => {
  const origin = 'https://app.chatwoot.com';
  const link = document.getElementById('deal-open');
  const status = document.getElementById('deal-context');
  window.addEventListener('message', event => {
    if (window.parent === window || event.origin !== origin || event.source !== window.parent) return;
    let message;
    try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (message?.event !== 'appContext') return;
    link.hidden = true; link.removeAttribute('href');
    const conversation = message.data?.conversation;
    if (String(conversation?.account_id) !== '162472' || !/^\d+$/.test(String(conversation?.id || ''))) {
      status.textContent = 'Selecciona una conversación de Clinyco.'; return;
    }
    // Pass only the conversation ID. The authenticated server resolves its contact.
    link.href = `https://clinyco-ai.netlify.app/?dealConversation=${conversation.id}`;
    status.textContent = `Conversación #${conversation.id}`;
    link.hidden = false;
  });
  if (window.parent !== window) window.parent.postMessage('chatwoot-dashboard-app:fetch-info', origin);
})();
