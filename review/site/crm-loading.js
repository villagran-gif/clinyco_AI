// The API paginates without a total: visual progress is estimated, never a fake percentage.
(() => {
  window.createCrmLoadProgress = ({root, bar, fill, status, regions, clock = window}) => {
    let timer = null, hideTimer = null, value = 0, ticks = 0, received = 0, active = false;
    const stop = () => { clock.clearInterval(timer); clock.clearTimeout(hideTimer); timer = hideTimer = null; };
    const paint = next => {
      value = next;
      fill.style.width = `${value}%`;
      fill.style.backgroundColor = `hsl(${Math.round(28 + value * .55)} 75% 42%)`;
    };
    const message = text => { status.textContent = text; bar.setAttribute('aria-valuetext', text); };
    const busy = flag => regions.forEach(region => region.setAttribute('aria-busy', String(flag)));
    return {
      start() {
        stop(); active = true; ticks = received = 0;
        root.hidden = false; root.dataset.state = 'loading';
        bar.removeAttribute('aria-valuenow'); busy(true); paint(5);
        message('Cargando DEALS… Preparando la consulta.');
        timer = clock.setInterval(() => {
          if (!root.isConnected) { active = false; stop(); return; }
          ticks++;
          // Leave headroom for receiving the last page and rendering the table.
          paint(Math.min(90, value + Math.max(.25, (90 - value) * .055)));
          if (ticks === 20) message(`La carga está tardando más de lo habitual. Seguimos esperando${received ? ` · ${received} DEALS recibidos` : ''}…`);
        }, 750);
      },
      page(count) {
        if (!active) return;
        received = count; paint(Math.min(90, Math.max(value, 20) + 7));
        message(`Cargando DEALS… ${received} recibidos. Avance estimado.`);
      },
      rendering() {
        if (!active) return;
        clock.clearInterval(timer); timer = null;
        paint(95); message('Preparando la tabla de DEALS…');
      },
      complete(text) {
        if (!active) return;
        stop(); active = false; busy(false); paint(100);
        root.dataset.state = 'complete'; fill.style.backgroundColor = '#228044';
        bar.setAttribute('aria-valuenow', '100'); message(text);
        hideTimer = clock.setTimeout(() => { root.hidden = true; }, 2200);
      },
      fail(text) {
        stop(); active = false; busy(false); root.hidden = false;
        root.dataset.state = 'error'; fill.style.backgroundColor = '#b42318';
        bar.removeAttribute('aria-valuenow'); message(`${text} Pulsa «Actualizar DEALS» para reintentar.`);
      },
      dispose() { stop(); active = false; busy(false); }
    };
  };
})();
