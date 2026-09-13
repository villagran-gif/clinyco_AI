(() => {
  const id = new URLSearchParams(location.search).get('conversation');
  if (!/^[1-9]\d{0,15}$/.test(id || '')) return;
  const $ = id => document.getElementById(id);
  const endpoint = `/api/antonia/conversations/${id}/control`;
  let state = null, busy = false, request = null;
  function buttons() {
    $('control-pause').disabled = busy || !state || state.mode === 'human_active';
    $('control-resume').disabled = busy || !state || state.mode !== 'human_active' || state.pending.length > 0;
    $('control-refresh').disabled = busy;
  }
  function render(value) {
    state = value;
    $('control-status').textContent = `Conversación #${id}: ` + (state.mode === 'bot_active'
      ? 'Antonia activa.' : state.pause_status === 'pause_pending'
        ? 'Pausa pendiente: los nuevos envíos están bloqueados; hay una operación en curso o sin resultado confirmado. El equipo técnico debe verificarla antes de reactivar.'
        : 'Pausa confirmada. El equipo tiene el control.');
    buttons();
  }
  async function refresh() {
    busy = true; buttons();
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error();
      render(await response.json());
    } catch {
      state = null;
      $('control-status').textContent = 'No se pudo comprobar el estado. Los controles quedan deshabilitados.';
    } finally { busy = false; buttons(); }
  }
  async function change(action) {
    if (busy || !state) return;
    const reason = $('control-reason').value.trim();
    if (!reason) { $('control-result').textContent = 'Escribe el motivo del cambio.'; return; }
    const signature = JSON.stringify([action,reason,state.revision]);
    if (request?.signature !== signature) request = {signature,id:crypto.randomUUID()};
    busy = true; buttons();
    $('control-result').textContent = 'Guardando cambio…';
    try {
      const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,reason,requestId:request.id,expected_revision:state.revision})});
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          request = null;
          $('control-result').textContent = 'El estado cambió o hay un envío por verificar. Actualiza el estado antes de volver a intentarlo.';
          state = null;
          return;
        }
        throw new Error();
      }
      render(body); request = null;
      $('control-reason').value = '';
      $('control-result').textContent = action === 'resume' ? 'Reactivación guardada. Antonia espera el próximo mensaje.' : 'Toma de control guardada.';
    } catch { $('control-result').textContent = 'No pudimos confirmar el cambio. Actualiza el estado antes de intentarlo nuevamente.'; state = null; }
    finally { busy = false; buttons(); }
  }
  $('control-refresh').onclick = refresh;
  $('control-pause').onclick = () => change('pause');
  $('control-resume').onclick = () => change('resume');
  Promise.resolve(window.reviewAuthReady).then(ready => {
    if (ready) { $('antonia-control').hidden = false; void refresh(); }
  });
})();
