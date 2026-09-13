/* Availability is a read-only snapshot. A missing day is not a closed agenda. */
(function (root) {
  'use strict';
  const ALL = '__all__';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function rows(data) {
    return Object.entries(data?.sucursales || {}).flatMap(([id, branch]) => (branch.profesionales || []).map(p => ({...p, sucursalId: id, sucursal: branch.nombre || id})));
  }
  function filtered(data, professional = ALL, branch = ALL, search = '') {
    const q = normalize(search);
    return rows(data).filter(p => (professional === ALL || String(p.id) === professional) && (branch === ALL || p.sucursalId === branch) && (!q || normalize(p.nombre + ' ' + p.especialidad).includes(q)));
  }
  function slotInfo(prof, date) {
    const slot = (prof.slots || []).find(s => s.fecha === date);
    if (!slot) return {horas: [], disponibles: null, ocupados: null, total: null, percentage: null};
    const horas = Array.isArray(slot.horas) ? [...new Set(slot.horas)] : [];
    const disponibles = numeric(slot.disponibles) ?? (Array.isArray(slot.horas) ? horas.length : null);
    const total = numeric(slot.total);
    const ocupados = numeric(slot.ocupados) ?? (total !== null && disponibles !== null && total >= disponibles ? total - disponibles : null);
    // Explicit zeros must survive. Inconsistent or incomplete totals do not imply 0% occupied.
    const known = slot.occupancyKnown !== false && prof.occupancyKnown !== false && total > 0 && disponibles !== null && ocupados !== null && disponibles + ocupados === total;
    return {horas, disponibles, ocupados, total, percentage: known ? ocupados / total * 100 : null};
  }
  function color(percentage) {
    if (percentage === null || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return 'unknown';
    return percentage <= 25 ? 'red' : percentage <= 50 ? 'orange' : percentage < 75 ? 'yellow' : 'green';
  }
  function avatar(prof) {
    if (!prof.avatar_url) return '';
    try {
      const url = new URL(prof.avatar_url, 'https://clinyco.medinetapp.com');
      return url.protocol === 'https:' ? `<img class="mn-avatar" src="${esc(url.href)}" alt="" loading="lazy">` : '';
    } catch { return ''; }
  }
  function minutes(time) {
    const m = String(time).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function overlaps(data, id, date) {
    const offers = rows(data).filter(p => String(p.id) === String(id)).flatMap(p => {
      const duration = numeric(p.duracion_cita);
      return slotInfo(p, date).horas.map(time => ({branch: p.sucursalId, name: p.sucursal, time, start: minutes(time), duration})).filter(o => o.start !== null);
    });
    const result = [];
    for (let i = 0; i < offers.length; i++) for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i], b = offers[j];
      if (a.branch === b.branch) continue;
      const knownDuration = a.duration > 0 && b.duration > 0;
      if (knownDuration ? a.start < b.start + b.duration && b.start < a.start + a.duration : a.start === b.start) {
        result.push({a, b, knownDuration});
      }
    }
    return result;
  }
  function alerts(data, id, date) {
    const result = [];
    const age = Date.now() - Date.parse(data?.syncedAt);
    if (!Number.isFinite(age) || age > 20 * 60000) result.push('Datos pendientes de actualizar: comprobar la disponibilidad actual en Medinet antes de ofrecer una hora.');
    const conflicts = overlaps(data, id, date);
    if (conflicts.length) {
      result.push(`⚠ ${conflicts.length} cruce(s) de cupos ofrecidos entre sedes. Comprobar antes de agendar; esto no confirma una doble reserva.`);
      conflicts.slice(0, 5).forEach(({a,b,knownDuration}) => result.push(`${a.name} ${a.time}${knownDuration ? ` (${a.duration} min)` : ''} ↔ ${b.name} ${b.time}${knownDuration ? ` (${b.duration} min)` : ' · duración por verificar'}`));
      if (conflicts.length > 5) result.push(`Y ${conflicts.length - 5} cruces adicionales para esta fecha.`);
    }
    const tele = rows(data).filter(p => String(p.id) === String(id) && (/telemedicina/i.test(p.sucursal) || ['2','3'].includes(p.sucursalId)));
    if (!tele.some(p => slotInfo(p, date).disponibles > 0)) result.push('⚠ Telemedicina por comprobar: no aparecen cupos para este día. Confirmar con el profesional si puede habilitar atención remota; no equivale a indisponibilidad confirmada.');
    return result;
  }
  function chileDate() {
    const parts = new Intl.DateTimeFormat('en', {timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  root.MedinetAvailability = {rows, filtered, slotInfo, color, overlaps, alerts};
  if (!root.document) return;
  const $ = id => root.document.getElementById(id);
  let data = null, professional = ALL, branch = ALL, search = '', anchor = null;
  function dates() {
    const first = new Date(chileDate() + 'T12:00:00Z');
    return Array.from({length: data?.daysAhead || 14}, (_, i) => {
      const d = new Date(first); d.setUTCDate(d.getUTCDate() + i);
      return {iso:d.toISOString().slice(0,10), label:d.toLocaleDateString('es-CL',{weekday:'short',day:'numeric',month:'numeric',timeZone:'UTC'})};
    });
  }
  function populate() {
    const professionals = [...new Map(rows(data).map(p => [String(p.id), p.nombre])).entries()].sort((a,b) => a[1].localeCompare(b[1], 'es'));
    if (!professionals.some(([id]) => id === professional)) professional = ALL;
    $('mn-professional').innerHTML = `<option value="${ALL}">Todos</option>` + professionals.map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    $('mn-professional').value = professional;
    const available = new Set(filtered(data, professional).map(p => p.sucursalId));
    const branches = Object.entries(data.sucursales || {}).filter(([id]) => professional === ALL || available.has(id));
    if (!branches.some(([id]) => id === branch)) branch = ALL;
    $('mn-sucursal').innerHTML = `<option value="${ALL}">Todas</option>` + branches.map(([id,b]) => `<option value="${esc(id)}">${esc(b.nombre || id)}</option>`).join('');
    $('mn-sucursal').value = branch;
  }
  function closeDetail(restoreFocus = false) {
    $('mn-detail-popup').hidden = true;
    if (restoreFocus && anchor?.isConnected) anchor.focus();
    anchor = null;
  }
  function detail(button) {
    const p = rows(data).find(p => String(p.id) === button.dataset.professional && p.sucursalId === button.dataset.branch);
    if (!p) return;
    anchor = button;
    const date = button.dataset.date, info = slotInfo(p, date), popup = $('mn-detail-popup');
    const messages = alerts(data, p.id, date);
    popup.innerHTML = `<button type="button" id="mn-detail-close" aria-label="Cerrar horarios">×</button><h4>${esc(p.nombre)}</h4><p>${esc(p.sucursal)} · ${esc(date)}</p>` +
      `<p>${info.disponibles ?? 'Sin dato'} libres · ${info.ocupados ?? 'Sin dato'} ocupados · ${info.total ?? 'Sin dato'} total${info.percentage !== null ? ` · ${Number(info.percentage.toFixed(1))}% ocupado` : ''}</p>` +
      `<div class="mn-hours">${info.horas.map(h => `<span>${esc(h)}</span>`).join('') || '<p>No aparecen horas libres en esta consulta. Comprobar la agenda en Medinet.</p>'}</div>` +
      (messages.length ? `<div class="mn-warnings"><strong>Comprobaciones sugeridas</strong><ul>${messages.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : '');
    popup.hidden = false;
    const rect = button.getBoundingClientRect(), width = popup.getBoundingClientRect().width;
    popup.style.left = Math.max(8, Math.min(rect.left + rect.width/2 - width/2, root.innerWidth - width - 8)) + 'px';
    const height = popup.getBoundingClientRect().height;
    popup.style.top = Math.max(8, Math.min(rect.bottom + 8, root.innerHeight - height - 8)) + 'px';
    $('mn-detail-close').onclick = () => closeDetail(true);
    $('mn-detail-close').focus();
  }
  function render() {
    closeDetail();
    const list = filtered(data, professional, branch, search), ds = dates();
    const ids = new Set(list.map(p => String(p.id)));
    const availableIds = new Set(list.filter(p => (p.slots || []).some(s => slotInfo(p,s.fecha).disponibles > 0)).map(p => String(p.id)));
    const count = list.reduce((sum,p) => sum + (p.slots || []).reduce((n,s) => n + (slotInfo(p,s.fecha).disponibles ?? 0), 0), 0);
    $('mn-summary').innerHTML = [[ids.size,'Profesionales'],[availableIds.size,'Con cupos'],[count,'Cupos ofrecidos por sede'],[ds.length,'Días de cobertura']].map(([value,label]) => `<div class="mn-summary-card"><strong>${value}</strong><span>${label}</span></div>`).join('');
    let overview = '';
    if (professional !== ALL) {
      const matches = filtered(data, professional);
      const tele = matches.filter(p => /telemedicina/i.test(p.sucursal) || ['2','3'].includes(p.sucursalId));
      const conflictDates = ds.filter(d => overlaps(data, professional, d.iso).length);
      overview = `<p>Sedes del profesional: ${[...new Set(matches.map(p => p.sucursal))].map(esc).join(' · ')}</p>`;
      if (conflictDates.length) overview += `<p class="mn-warning">⚠ Cupos simultáneos entre sedes en ${conflictDates.length} día(s). Abre una celda para revisar los horarios.</p>`;
      if (!tele.some(p => ds.some(d => slotInfo(p,d.iso).disponibles > 0))) overview += '<p class="mn-warning">⚠ No aparecen cupos de telemedicina en el período. Solicitar comprobación al profesional antes de descartar esta opción.</p>';
    }
    const age = Date.now() - Date.parse(data?.syncedAt);
    if (!Number.isFinite(age) || age > 20 * 60000) overview += '<p class="mn-warning">⚠ Disponibilidad pendiente de actualizar. Comprobar en Medinet antes de agendar.</p>';
    $('mn-alerts').innerHTML = overview;
    $('mn-grid').innerHTML = list.length ? `<table class="mn-table"><thead><tr><th>Profesional / sede</th>${ds.map(d => `<th>${esc(d.label)}</th>`).join('')}</tr></thead><tbody>` + list.map(p => `<tr><th scope="row">${avatar(p)}<strong>${esc(p.nombre)}</strong><span>${esc(p.especialidad)}</span><span class="mn-branch">${esc(p.sucursal)}</span></th>` + ds.map(d => {
      const info = slotInfo(p,d.iso), c = color(info.percentage);
      const label = info.total > 0 && info.disponibles !== null ? `${info.disponibles}/${info.total}` : info.disponibles > 0 ? `${info.disponibles}/?` : '—';
      const title = `${p.nombre} · ${p.sucursal} · ${d.iso} · ${info.disponibles ?? 'Sin dato'} libres / ${info.total ?? 'Sin dato'} total · ${info.percentage === null ? 'Ocupación sin dato' : `${Number(info.percentage.toFixed(1))}% ocupado`}`;
      return `<td><button type="button" class="mn-slot mn-occupancy-${c}" data-professional="${esc(p.id)}" data-branch="${esc(p.sucursalId)}" data-date="${d.iso}" title="${esc(title)}" aria-label="${esc(title)}">${label}</button></td>`;
    }).join('') + '</tr>').join('') + '</tbody></table>' : '<p class="mn-empty">Sin profesionales que coincidan con los filtros.</p>';
  }
  root.loadMedinet = async function () {
    try {
      const next = await root.api('/medinet/slots');
      if (next.error) throw new Error(next.error);
      data = next;
      $('mn-loading').style.display = 'none'; $('mn-content').style.display = 'block';
      const age = Date.now() - Date.parse(data.syncedAt);
      $('mn-sync-badge').textContent = Number.isFinite(age) ? age < 20*60000 ? 'Actualizado' : 'Desactualizado' : 'Sin datos';
      $('mn-sync-time').textContent = data.syncedAt ? 'Sync: ' + new Date(data.syncedAt).toLocaleString('es-CL', {timeZone:'America/Santiago'}) + ' (Chile)' : '';
      $('mn-legend').innerHTML = '<span>Celdas: <strong>libres / total</strong>. Color: <strong>ocupación</strong>.</span>' + [['red','Rojo ≤25%'],['orange','Naranjo >25–50%'],['yellow','Amarillo >50–<75%'],['green','Verde ≥75%'],['unknown','Sin dato']].map(([c,label]) => `<span class="mn-legend-key mn-occupancy-${c}">${label}</span>`).join('') + '<small>Los cupos por sede pueden coincidir. «—» no confirma agenda cerrada; bloqueos no incluidos.</small>';
      populate(); render(); root._medinetLoaded = true;
      $('mn-professional').onchange = event => {professional = event.target.value; branch = ALL; search = ''; $('mn-search').value = ''; populate(); render();};
      $('mn-sucursal').onchange = event => {branch = event.target.value; render();};
      $('mn-search').oninput = event => {search = event.target.value; render();};
      $('mn-grid').onclick = event => {const button = event.target.closest('button.mn-slot'); if (button) detail(button);};
    } catch (error) {
      $('mn-loading').style.display = 'block';
      $('mn-loading').textContent = 'No se pudo actualizar Medinet. Intenta nuevamente.';
      if (data) $('mn-alerts').textContent = '⚠ Falló la actualización. Los datos visibles corresponden a la última consulta.';
    }
  };
  root.document.addEventListener('keydown', event => {if (event.key === 'Escape' && !$('mn-detail-popup').hidden) closeDetail(true);});
  root.document.addEventListener('click', event => {if (anchor && !event.target.closest('#mn-detail-popup, .mn-slot')) closeDetail();});
  root.addEventListener('resize', () => closeDetail());
})(globalThis);
