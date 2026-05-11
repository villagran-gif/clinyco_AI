(function () {
  'use strict';

  var API_BASE = 'http://69.6.226.132:3002';
  var REFRESH_MS = 5 * 60 * 1000;
  var data = null;
  var selectedSucursal = '';
  var searchQuery = '';

  var sucursalSelect = document.getElementById('sucursal-select');
  var searchInput = document.getElementById('search-input');
  var summaryCards = document.getElementById('summary-cards');
  var gridContainer = document.getElementById('grid-container');
  var syncBadge = document.getElementById('sync-badge');
  var syncTime = document.getElementById('sync-time');
  var detailPopup = document.getElementById('slot-detail');

  function fetchData() {
    fetch(API_BASE + '/api/slots')
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (json.error) {
          showEmpty(json.error);
          return;
        }
        data = json;
        updateSyncStatus();
        populateSucursalSelect();
        render();
      })
      .catch(function (err) {
        showEmpty('Error al conectar: ' + err.message);
      });
  }

  function updateSyncStatus() {
    if (!data || !data.syncedAt) {
      syncBadge.textContent = 'Sin datos';
      syncBadge.className = 'badge badge-none';
      syncTime.textContent = '';
      return;
    }

    var syncDate = new Date(data.syncedAt);
    var ageMs = Date.now() - syncDate.getTime();
    var ageMin = Math.floor(ageMs / 60000);

    if (ageMin < 20) {
      syncBadge.textContent = 'Actualizado';
      syncBadge.className = 'badge badge-ok';
    } else if (ageMin < 60) {
      syncBadge.textContent = 'Hace ' + ageMin + ' min';
      syncBadge.className = 'badge badge-stale';
    } else {
      syncBadge.textContent = 'Desactualizado';
      syncBadge.className = 'badge badge-none';
    }

    syncTime.textContent = 'Ultima sync: ' + syncDate.toLocaleString('es-CL');
  }

  function populateSucursalSelect() {
    if (!data || !data.sucursales) return;
    var keys = Object.keys(data.sucursales);
    if (sucursalSelect.options.length > 0 && selectedSucursal) return;

    sucursalSelect.innerHTML = '';
    if (keys.length > 1) {
      var allOpt = document.createElement('option');
      allOpt.value = '__all__';
      allOpt.textContent = 'Todas las sucursales';
      sucursalSelect.appendChild(allOpt);
    }
    keys.forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = data.sucursales[key].nombre || key;
      sucursalSelect.appendChild(opt);
    });
    selectedSucursal = sucursalSelect.value;
  }

  function getDates() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var days = data ? (data.daysAhead || 14) : 14;
    var dates = [];
    for (var i = 0; i < days; i++) {
      var d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

  function formatDateShort(date) {
    var dias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    return dias[date.getDay()] + ' ' + date.getDate() + '/' + (date.getMonth() + 1);
  }

  function toIso(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function getProfessionals() {
    if (!data || !data.sucursales) return [];
    var profs = [];
    var keys = selectedSucursal === '__all__' ? Object.keys(data.sucursales) : [selectedSucursal];

    keys.forEach(function (key) {
      var suc = data.sucursales[key];
      if (!suc || !suc.profesionales) return;
      suc.profesionales.forEach(function (p) {
        profs.push(Object.assign({}, p, { sucursal: suc.nombre, sucursalId: key }));
      });
    });

    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      profs = profs.filter(function (p) {
        return (p.nombre || '').toLowerCase().includes(q)
          || (p.especialidad || '').toLowerCase().includes(q)
          || (p.sucursal || '').toLowerCase().includes(q);
      });
    }

    return profs;
  }

  function getSlotCount(prof, isoDate) {
    if (!prof.slots) return 0;
    for (var i = 0; i < prof.slots.length; i++) {
      if (prof.slots[i].fecha === isoDate) return prof.slots[i].horas.length;
    }
    return 0;
  }

  function getSlotHoras(prof, isoDate) {
    if (!prof.slots) return [];
    for (var i = 0; i < prof.slots.length; i++) {
      if (prof.slots[i].fecha === isoDate) return prof.slots[i].horas;
    }
    return [];
  }

  function slotClass(count) {
    if (count === 0) return 'slot-0';
    if (count <= 2) return 'slot-low';
    if (count <= 5) return 'slot-mid';
    return 'slot-high';
  }

  function render() {
    var dates = getDates();
    var profs = getProfessionals();

    var totalProfs = profs.length;
    var totalSlots = 0;
    var profsWithSlots = 0;

    profs.forEach(function (p) {
      var pSlots = (p.slots || []).reduce(function (s, slot) { return s + slot.horas.length; }, 0);
      totalSlots += pSlots;
      if (pSlots > 0) profsWithSlots++;
    });

    summaryCards.innerHTML =
      '<div class="summary-card"><div class="value">' + totalProfs + '</div><div class="label">Profesionales</div></div>' +
      '<div class="summary-card"><div class="value">' + profsWithSlots + '</div><div class="label">Con disponibilidad</div></div>' +
      '<div class="summary-card"><div class="value">' + totalSlots + '</div><div class="label">Horas totales</div></div>' +
      '<div class="summary-card"><div class="value">' + (data ? data.daysAhead : 14) + '</div><div class="label">Dias de cobertura</div></div>';

    if (!profs.length) {
      gridContainer.innerHTML = '<div class="empty-state"><h2>Sin resultados</h2><p>No hay profesionales que coincidan con la busqueda.</p></div>';
      return;
    }

    var html = '<table class="slot-grid"><thead><tr><th>Profesional</th>';
    dates.forEach(function (d) {
      var iso = toIso(d);
      var isToday = iso === toIso(new Date());
      html += '<th' + (isToday ? ' style="color:#6ee7b7;border-bottom-color:#6ee7b7"' : '') + '>' + formatDateShort(d) + '</th>';
    });
    html += '</tr></thead><tbody>';

    profs.forEach(function (prof) {
      html += '<tr><td><div class="prof-cell">';
      if (prof.avatar_url) {
        var avatarSrc = prof.avatar_url.startsWith('http') ? prof.avatar_url : 'https://clinyco.medinetapp.com' + prof.avatar_url;
        html += '<img class="prof-avatar" src="' + avatarSrc + '" alt="" onerror="this.style.display=\'none\'" />';
      }
      html += '<div class="prof-info"><div class="prof-name" title="' + escHtml(prof.nombre) + '">' + escHtml(prof.nombre) + '</div>';
      html += '<div class="prof-spec" title="' + escHtml(prof.especialidad) + '">' + escHtml(truncate(prof.especialidad, 35)) + '</div></div></div></td>';

      dates.forEach(function (d) {
        var iso = toIso(d);
        var count = getSlotCount(prof, iso);
        var cls = slotClass(count);
        html += '<td><div class="slot-cell ' + cls + '"';
        if (count > 0) {
          html += ' data-prof-id="' + prof.id + '" data-fecha="' + iso + '"';
          html += ' onmouseenter="window._showDetail(event,this)" onmouseleave="window._hideDetail()"';
        }
        html += '>' + (count > 0 ? count : '-') + '</div></td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    gridContainer.innerHTML = html;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function truncate(str, max) {
    str = str || '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  window._showDetail = function (event, el) {
    var profId = el.getAttribute('data-prof-id');
    var fecha = el.getAttribute('data-fecha');
    if (!profId || !fecha) return;

    var profs = getProfessionals();
    var prof = null;
    for (var i = 0; i < profs.length; i++) {
      if (String(profs[i].id) === String(profId)) { prof = profs[i]; break; }
    }
    if (!prof) return;

    var horas = getSlotHoras(prof, fecha);
    if (!horas.length) return;

    var dateObj = new Date(fecha + 'T12:00:00');
    var dateLabel = dateObj.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });

    var html = '<h4>' + escHtml(prof.nombre) + '</h4>';
    html += '<div style="color:#94a3b8;margin-bottom:6px;font-size:11px">' + escHtml(dateLabel) + ' (' + horas.length + ' horas)</div>';
    html += '<div class="times">';
    horas.forEach(function (h) {
      html += '<span class="time-chip">' + escHtml(h) + '</span>';
    });
    html += '</div>';

    detailPopup.innerHTML = html;
    detailPopup.style.display = 'block';

    var rect = el.getBoundingClientRect();
    var popupWidth = 260;
    var left = rect.left + rect.width / 2 - popupWidth / 2;
    if (left < 8) left = 8;
    if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8;
    var top = rect.bottom + 8;
    if (top + 200 > window.innerHeight) top = rect.top - 200;

    detailPopup.style.left = left + 'px';
    detailPopup.style.top = top + 'px';
  };

  window._hideDetail = function () {
    detailPopup.style.display = 'none';
  };

  sucursalSelect.addEventListener('change', function () {
    selectedSucursal = this.value;
    render();
  });

  var searchTimeout = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimeout);
    var val = this.value;
    searchTimeout = setTimeout(function () {
      searchQuery = val;
      render();
    }, 300);
  });

  function showEmpty(message) {
    gridContainer.innerHTML = '<div class="empty-state"><h2>Sin datos</h2><p>' + escHtml(message) + '</p></div>';
    summaryCards.innerHTML = '';
  }

  fetchData();
  setInterval(fetchData, REFRESH_MS);
})();
