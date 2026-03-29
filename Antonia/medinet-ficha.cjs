const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://clinyco.medinetapp.com';
const BACKEND_BASE = 'https://sell-medinet-backend.onrender.com';
const DEFAULT_USER_DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.clinyco-playwright-profile'
);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalizeText(s) {
  return (s ?? '')
    .toString()
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function coalesce(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && `${v}`.trim() !== '') return v;
  }
  return '';
}

function normalizeDateToDDMMYYYY(input) {
  if (!input) return '';
  const s = input.toString().trim();

  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;

  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

  const m3 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m3) return s;

  const parts = s.split(/[-/]/).map((x) => x.trim());
  if (parts.length === 3) {
    if (parts[0].length === 4) return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    if (parts[2].length === 4) return `${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[2]}`;
  }
  return s;
}

function buildApellidos(payload) {
  const direct = (payload.apellidos ?? payload.apellido ?? '').toString().trim();
  if (direct) return direct;
  const p = (payload.apellidoPaterno ?? payload.paterno ?? '').toString().trim();
  const m = (payload.apellidoMaterno ?? payload.materno ?? '').toString().trim();
  return `${p} ${m}`.trim();
}

function getDealUrlFromPayload(payload) {
  const direct = coalesce(payload.deal_url, payload.dealUrl);
  if (direct) return String(direct).trim();
  const id = coalesce(payload.deal_id, payload.dealId, payload.dealID);
  if (id) return `https://clinyco.zendesk.com/sales/deals/${String(id).trim()}`;
  return '';
}

// ---------------------------------------------------------------------------
// Payload adapter — compatible with Zendesk Sell, direct JSON, etc.
// ---------------------------------------------------------------------------

function adaptToMedinetShape(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const src =
    (r.payload && typeof r.payload === 'object' ? r.payload : null) ||
    (r.data && typeof r.data === 'object' ? r.data : null) ||
    (r.patient && typeof r.patient === 'object' ? { ...r, ...r.patient } : null) ||
    r;

  const get = (...keys) => {
    for (const k of keys) {
      const v = src?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  };

  const tel1 = String(get('telefono1', 'tel1', 'telefono', 'phone', 'celular', 'mobile')).trim();
  const tel2 = String(get('telefono2', 'tel2', 'telefono_b', 'phone2', 'mobile2')).trim();

  const modalidad = String(
    get('modalidad', 'prevision', 'seguro', 'tramo_modalidad', 'tramoModalidad', 'tramo_modalidad_text', 'isapre')
  ).trim();

  const aseguradora = String(get('aseguradora', 'aseguradoraNombre', 'aseguradora_nombre')).trim();

  let nombres = String(get('nombres', 'nombre', 'firstName', 'first_name', 'first')).trim();
  let apellidos = String(get('apellidos', 'apellido', 'lastName', 'last_name', 'last')).trim();

  const fechaNacimiento = String(
    get('fechaNacimiento', 'fecha_nacimiento', 'dob', 'birthDate', 'birth_date')
  ).trim();

  const out = {
    rut: String(get('rut', 'run', 'RUN', 'RUT', 'identifier', 'identifierValue')).trim(),
    nombres,
    apellidos,
    fechaNacimiento,
    telefono: tel1 || tel2 || '',
    telefono1: tel1 || '',
    telefono2: tel2 || tel1 || '',
    email: String(get('email', 'correo', 'correoElectronico', 'correo_electronico')).trim(),
    direccion: String(get('direccion', 'address', 'domicilio')).trim(),
    comuna: String(get('comuna', 'municipio', 'commune')).trim(),
    modalidad,
    aseguradora: (aseguradora || modalidad || '').trim(),
    peso: String(get('peso', 'weight', 'peso_kg', 'weight_kg', 'weightKg')).trim(),
    talla: String(get('talla', 'estatura', 'altura', 'height', 'height_cm', 'heightCm')).trim(),
    deal_id: String(get('deal_id', 'dealId', 'dealID')).trim(),
    deal_url: String(get('deal_url', 'dealUrl', 'dealURL')).trim(),
    contact_id: String(get('contact_id', 'contactId', 'contactID')).trim(),
    contact_url: String(get('contact_url', 'contactUrl', 'contactURL')).trim(),
  };

  if (!out.apellidos) {
    const p = String(get('apellidoPaterno', 'paterno')).trim();
    const m = String(get('apellidoMaterno', 'materno')).trim();
    out.apellidos = `${p} ${m}`.trim();
  }
  if (!out.nombres) out.nombres = String(get('first_name', 'firstName')).trim();
  if (!out.apellidos) out.apellidos = String(get('last_name', 'lastName')).trim();

  return out;
}

// ---------------------------------------------------------------------------
// Load payload from env / file / sell backend
// ---------------------------------------------------------------------------

async function loadPayload() {
  const envPayload = process.env.MEDINET_PAYLOAD;
  if (envPayload) {
    return JSON.parse(envPayload);
  }

  const payloadFile = process.env.MEDINET_PAYLOAD_FILE;
  if (payloadFile) {
    const content = fs.readFileSync(path.resolve(payloadFile), 'utf8');
    return JSON.parse(content);
  }

  const mfKey = process.env.MEDINET_MF_KEY;
  if (mfKey) {
    const url = `${BACKEND_BASE.replace(/\/$/, '')}/medinet/payload/${encodeURIComponent(mfKey)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${t || res.statusText}`);
    }
    return await res.json();
  }

  throw new Error('Se requiere MEDINET_PAYLOAD, MEDINET_PAYLOAD_FILE, o MEDINET_MF_KEY.');
}

// ---------------------------------------------------------------------------
// Playwright helpers
// ---------------------------------------------------------------------------

const log = (...a) => console.log('[MedinetFicha]', ...a);
const warn = (...a) => console.warn('[MedinetFicha]', ...a);

async function fillInput(page, selectors, value) {
  if (!value && value !== '') return false;
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];

  for (const sel of selectorList) {
    const loc = page.locator(sel).first();
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;

    await loc.fill(String(value));
    await loc.dispatchEvent('input');
    await loc.dispatchEvent('change');
    await loc.dispatchEvent('blur');
    return true;
  }
  warn('No encontre input visible:', selectorList.join(', '));
  return false;
}

async function fillInputWithRetry(page, selectors, value, retries = 5) {
  const ok = await fillInput(page, selectors, value);
  if (!ok) return false;

  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const desired = String(value).trim();

  const delays = [150, 250, 400, 700, 1100];
  for (let i = 0; i < Math.min(retries, delays.length); i++) {
    await page.waitForTimeout(delays[i]);
    for (const sel of selectorList) {
      const loc = page.locator(sel).first();
      const visible = await loc.isVisible().catch(() => false);
      if (!visible) continue;
      const current = await loc.inputValue().catch(() => '');
      if (current.trim() === '' && desired !== '') {
        await loc.fill(desired);
        await loc.dispatchEvent('input');
        await loc.dispatchEvent('change');
      }
      break;
    }
  }
  return true;
}

async function pickBootstrapSelect(page, selectSelector, desiredText, timeoutMs = 5000) {
  const want = normalizeText(desiredText);
  if (!want) return true;

  const selectLoc = page.locator(selectSelector).first();
  await selectLoc.waitFor({ state: 'attached', timeout: timeoutMs }).catch(() => {});

  // Check if it's wrapped in a bootstrap-select container
  const container = page.locator(selectSelector)
    .locator('xpath=ancestor-or-self::div[contains(@class,"bootstrap-select")]')
    .first();
  const hasContainer = await container.isVisible().catch(() => false);

  if (hasContainer) {
    const toggleBtn = container.locator('button.dropdown-toggle').first();
    await toggleBtn.click();
    await page.waitForTimeout(150);

    const links = container.locator('ul.dropdown-menu.inner li a');
    const count = await links.count();

    let bestMatch = null;
    let bestIdx = -1;

    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const spanText = await link.locator('span.text').first().textContent().catch(() => '');
      const linkText = spanText || (await link.textContent().catch(() => ''));
      const normalized = normalizeText(linkText);

      if (normalized === want) { bestIdx = i; break; }
      if (bestIdx === -1 && normalized.includes(want)) bestIdx = i;
      if (bestIdx === -1 && want.includes(normalized) && normalized.length > 3) bestIdx = i;
    }

    if (bestIdx >= 0) {
      await links.nth(bestIdx).click();
      await page.waitForTimeout(200);
      return true;
    }

    // Close dropdown if no match
    await toggleBtn.click().catch(() => {});
    warn(`Bootstrap-select: no match for "${desiredText}" in ${selectSelector}`);
    return false;
  }

  // Fallback: standard <select>
  const options = await selectLoc.locator('option').evaluateAll((opts) =>
    opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() })).filter((o) => o.value)
  );

  const found =
    options.find((o) => normalizeText(o.label) === want) ||
    options.find((o) => normalizeText(o.label).includes(want));

  if (!found) {
    warn(`Select: no match for "${desiredText}" in ${selectSelector}`);
    return false;
  }

  await selectLoc.selectOption(found.value);
  await selectLoc.dispatchEvent('change');
  return true;
}

async function ensureBootstrapSwitchOn(page, inputSelector) {
  const input = page.locator(inputSelector).first();
  const exists = await input.isVisible().catch(() => false);
  if (!exists) {
    // Switch might be hidden; check if it's attached
    const attached = await input.count().catch(() => 0);
    if (!attached) { warn('No encontre switch:', inputSelector); return false; }
  }

  const wrapper = page.locator(inputSelector)
    .locator('xpath=ancestor::div[contains(@class,"bootstrap-switch")]')
    .first();
  const hasWrapper = await wrapper.isVisible().catch(() => false);

  if (hasWrapper) {
    const isOn = await wrapper.evaluate((el) => el.classList.contains('bootstrap-switch-on'));
    if (isOn) return true;

    for (let i = 0; i < 3; i++) {
      await wrapper.click();
      await page.waitForTimeout(150);
      const nowOn = await wrapper.evaluate((el) => el.classList.contains('bootstrap-switch-on'));
      if (nowOn) return true;
    }
    warn('No logre encender switch:', inputSelector);
    return false;
  }

  // Fallback: direct checkbox
  const checked = await input.isChecked().catch(() => false);
  if (!checked) {
    await input.check({ force: true });
    await page.waitForTimeout(100);
  }
  return true;
}

async function safeClosePanelModal(page) {
  const modal = page.locator('#panelModal');
  const visible = await modal.isVisible().catch(() => false);
  if (!visible) return;

  const closeBtn = modal.locator('button[data-dismiss="modal"]').first();
  const hasClose = await closeBtn.isVisible().catch(() => false);
  if (hasClose) {
    await closeBtn.click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  // Wait for modal to hide
  await page.waitForFunction(() => {
    const m = document.querySelector('#panelModal');
    if (!m) return true;
    const style = window.getComputedStyle(m);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }, undefined, { timeout: 6000 }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Flow 1: Fill /pacientes/nuevo/
// ---------------------------------------------------------------------------

async function fillNuevoPaciente(page, payload) {
  log('Navegando a /pacientes/nuevo/ ...');
  await page.goto(`${BASE_URL}/pacientes/nuevo/`, { waitUntil: 'domcontentloaded' });

  // Wait for the form to load
  await page.waitForSelector('#id_form-0-run, input[name="run"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  // RUT — with keepAlive retry
  const rut = coalesce(payload.rut, payload.run);
  if (rut) {
    await fillInputWithRetry(
      page,
      ['#id_form-0-run', 'input[name="run"]', 'input[placeholder="RUN"]'],
      rut
    );
  }

  // Nombres
  const nombres = coalesce(payload.nombres, payload.nombre);
  if (nombres) {
    await fillInput(page, ['#id_form-0-nombres', 'input[name="nombres"]', 'input[placeholder="Nombres"]'], nombres);
  }

  // Social name — clear
  await fillInput(page, ['#id_form-0-social_name', 'input[name="social_name"]', 'input[placeholder="Nombre Social"]'], '');

  // Apellidos
  const apellidos = buildApellidos(payload);
  if (apellidos) {
    await fillInput(page, ['#id_form-0-paterno', 'input[name="apellidos"]', 'input[placeholder="Apellidos"]'], apellidos);
  }

  // Fecha nacimiento
  const fnRaw = coalesce(payload.fechaNacimiento, payload.fecha_nacimiento, payload.birthDate, payload.birth_date, payload.dob);
  const fn = normalizeDateToDDMMYYYY(fnRaw);
  if (fn) {
    const fnSelectors = [
      '#id_form-0-fecha_nacimiento',
      'input[name="fecha_nacimiento"]',
      'input[placeholder*="Fecha de Nacimiento"]',
    ];
    const ok = await fillInput(page, fnSelectors, fn);
    if (ok) {
      await page.waitForTimeout(300);
      // If field cleared itself, retry with slash format
      for (const sel of fnSelectors) {
        const loc = page.locator(sel).first();
        const visible = await loc.isVisible().catch(() => false);
        if (!visible) continue;
        const current = await loc.inputValue().catch(() => '');
        if (current.trim() === '' && fn.trim() !== '') {
          const alt = fn.replace(/-/g, '/');
          await loc.evaluate((input, val) => {
            input.removeAttribute('readonly');
            input.value = val;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, alt);
        }
        break;
      }
    }
  }

  // Telefonos
  const tel = coalesce(payload.telefono1, payload.telefono, payload.telefono2, payload.phone, payload.celular);
  if (tel) {
    await fillInput(page, [
      '#id_form-0-telefono_fijo', 'input[name="telefono"]',
      'input[placeholder="Teléfono 1"]', 'input[placeholder="Telefono 1"]',
    ], tel);
    await fillInput(page, [
      '#id_form-0-telefono_movil', '#id_form-0-celular', 'input[name="telefono2"]',
      'input[placeholder="Teléfono 2"]', 'input[placeholder="Telefono 2"]',
    ], tel);
  }

  // Email
  const email = coalesce(payload.email, payload.correo);
  if (email) {
    await fillInput(page, ['#email-paciente', 'input[name="email"]', 'input[placeholder="Correo electrónico"]'], email);
  }

  // Direccion
  const direccion = coalesce(payload.direccion, payload.address, payload.domicilio);
  if (direccion) {
    await fillInput(page, ['#id_form-0-direccion', 'input[name="direccion"]', 'input[placeholder="Dirección"]', 'input[placeholder="Direccion"]'], direccion);
  }

  // Comuna (bootstrap-select)
  const comuna = coalesce(payload.comuna, payload.municipio);
  if (comuna) {
    await pickBootstrapSelect(page, '#id_form-0-comuna', comuna);
  }

  // Modalidad / Aseguradora (bootstrap-select)
  const asegValue = coalesce(payload.aseguradora, payload.modalidad);
  if (asegValue) {
    await pickBootstrapSelect(page, '#id_form-0-modalidad', asegValue);
  }

  // Prevision (bootstrap-select)
  const modalidad = coalesce(payload.modalidad, payload.prevision, payload.tramo_modalidad);
  if (modalidad) {
    const prevOk = await pickBootstrapSelect(page, '#id_form-0-prevision', modalidad);
    if (!prevOk) {
      await pickBootstrapSelect(page, '#form-0-prevision', modalidad);
    }
  }

  // SMS switch
  await ensureBootstrapSwitchOn(page, '#id_enable_sms_notifications');

  // WSP switch
  await ensureBootstrapSwitchOn(page, '#id_enable_wsp_notifications');

  log('Relleno /pacientes/nuevo/ completado.');
}

// ---------------------------------------------------------------------------
// Flow 2: Fill /pacientes/ficha/{id}/
// ---------------------------------------------------------------------------

async function fillFicha(page, payload) {
  const patientId = process.env.MEDINET_PATIENT_ID;
  if (!patientId) throw new Error('Se requiere MEDINET_PATIENT_ID para el modo ficha.');

  log(`Navegando a /pacientes/ficha/${patientId}/ ...`);
  await page.goto(`${BASE_URL}/pacientes/ficha/${patientId}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const peso = coalesce(payload.peso, payload.weight);
  const talla = coalesce(payload.talla, payload.estatura, payload.altura, payload.height);
  const dealUrl = getDealUrlFromPayload(payload);

  // --- Antropometricos ---
  if (peso || talla) {
    log('Abriendo panel Antropometricos...');
    const trigger = page.locator([
      '.datos-antropometricos[data-target="#panelModal"]',
      '.datos-antropometricos[href*="/panel/antropometricos/"]',
      '[href*="/panel/antropometricos/"][data-target="#panelModal"]',
    ].join(', ')).first();

    const hasTrigger = await trigger.isVisible().catch(() => false);
    if (!hasTrigger) {
      warn('No encontre el disparador de Antropometricos.');
    } else {
      await trigger.click();
      await page.waitForTimeout(300);

      // Wait for peso or talla input in modal
      await page.waitForSelector('#id_peso, input[name="peso"], #id_talla, input[name="talla"]', {
        timeout: 8000,
      }).catch(() => warn('Timeout esperando inputs de antropometricos'));

      if (peso) {
        await fillInput(page, ['#id_peso', 'input[name="peso"]'], String(peso));
      }
      if (talla) {
        await fillInput(page, ['#id_talla', 'input[name="talla"]'], String(talla));
      }

      // Save
      const saveBtn = page.locator('#panelModal .js-btn-registrar-da, #panelModal button.btn-base.js-btn-registrar-da').first();
      const hasSave = await saveBtn.isVisible().catch(() => false);
      if (hasSave) {
        await saveBtn.click();
        await page.waitForTimeout(800);
      } else {
        warn('No encontre boton GUARDAR de Antropometricos.');
      }

      await safeClosePanelModal(page);
    }
  }

  // --- Cirugias ---
  if (dealUrl) {
    log('Abriendo panel Cirugias...');
    const cirTrigger = page.locator([
      'button[data-target="#panelModal"][href*="/panel/cirugias/"]',
      'a[data-target="#panelModal"][href*="/panel/cirugias/"]',
    ].join(', ')).first();

    const hasCirTrigger = await cirTrigger.isVisible().catch(() => false);
    if (!hasCirTrigger) {
      warn('No encontre el disparador de Cirugias.');
    } else {
      await cirTrigger.click();
      await page.waitForTimeout(300);

      await page.waitForSelector('input[name="cirugia"], #id_cirugia', {
        timeout: 8000,
      }).catch(() => warn('Timeout esperando input de cirugia'));

      await fillInput(page, ['input[name="cirugia"]', '#id_cirugia'], dealUrl);

      const saveCirBtn = page.locator('#panelModal .js-btn-guardar-diagnostico, #panelModal button.btn-base.js-btn-guardar-diagnostico').first();
      const hasSaveCir = await saveCirBtn.isVisible().catch(() => false);
      if (hasSaveCir) {
        await saveCirBtn.click();
        await page.waitForTimeout(800);
      } else {
        warn('No encontre boton AGREGAR de Cirugia.');
      }

      await safeClosePanelModal(page);
    }
  } else {
    warn('Ficha: sin deal_id/deal_url -> no se completa Cirugias.');
  }

  log('FICHA completada.');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main() {
  const mode = process.env.MEDINET_FICHA_MODE || 'nuevo';
  const headed = process.env.MEDINET_HEADED !== 'false';
  const userDataDir = process.env.MEDINET_USER_DATA_DIR || DEFAULT_USER_DATA_DIR;

  log(`Modo: ${mode} | Headed: ${headed} | Profile: ${userDataDir}`);

  // Load and adapt payload
  const raw = await loadPayload();
  const payload = adaptToMedinetShape(raw);
  if (payload.fechaNacimiento) {
    payload.fechaNacimiento = normalizeDateToDDMMYYYY(payload.fechaNacimiento);
  }

  log('Payload adaptado:', JSON.stringify(payload, null, 2));

  // Launch persistent browser context (reuses login session)
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1366, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    if (mode === 'nuevo' || mode === 'full') {
      await fillNuevoPaciente(page, payload);
    }

    if (mode === 'ficha' || mode === 'full') {
      await fillFicha(page, payload);
    }

    const response = {
      source: 'medinet_ficha',
      mode,
      success: true,
      payload_summary: {
        rut: payload.rut || '',
        nombres: payload.nombres || '',
        apellidos: payload.apellidos || '',
        peso: payload.peso || '',
        talla: payload.talla || '',
        deal_url: getDealUrlFromPayload(payload) || '',
      },
    };

    console.log('MEDINET_FICHA_RESPONSE', JSON.stringify(response, null, 2));
  } catch (error) {
    const response = {
      source: 'medinet_ficha',
      mode,
      success: false,
      error: error?.message || String(error),
    };
    console.error('MEDINET_FICHA_RESPONSE', JSON.stringify(response, null, 2));
    throw error;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

main().catch((error) => {
  console.error('MEDINET_FICHA_ERROR', error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
