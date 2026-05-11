const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AGENDA_URL = 'https://clinyco.medinetapp.com/agendaweb/planned/';
const DEFAULT_BRANCH_NAME = process.env.MEDINET_BRANCH_NAME || 'Antofagasta Mall Arauco Express';
const MAX_SLOTS = 6;
const CACHE_FILE = path.resolve(__dirname, '..', 'data', 'medinet_professionals_cache.json');
function normalizeSpaces(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value = '') {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isoToDisplayDate(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function pickRandomItem(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function buildVariants(name = '', specialty = '') {
  const variants = new Set();
  const normalizedName = normalizeText(name);
  const normalizedSpecialty = normalizeText(specialty);
  const tokens = normalizedName.split(' ').filter(Boolean);

  if (normalizedName) variants.add(normalizedName);
  if (normalizedSpecialty) variants.add(normalizedSpecialty);
  for (const token of tokens) variants.add(token);
  if (tokens.length >= 2) {
    variants.add(tokens.slice(0, 2).join(' '));
    variants.add(tokens.slice(-2).join(' '));
  }
  if (tokens.length >= 3) variants.add(tokens.slice(0, 3).join(' '));
  return [...variants];
}

function candidatePriority(candidate, query) {
  const requested = normalizeText(query);
  const normalizedName = normalizeText(candidate.name);
  const normalizedSpecialty = normalizeText(candidate.specialty);

  if (!requested) return 0;
  if (normalizedName === requested) return 1;
  if (candidate.variants.includes(requested)) return 2;
  if (normalizedName.startsWith(requested)) return 3;
  if (normalizedName.includes(requested)) return 4;
  if (normalizedSpecialty === requested) return 5;
  if (normalizedSpecialty.startsWith(requested)) return 6;
  if (normalizedSpecialty.includes(requested)) return 7;
  if (candidate.variants.some((variant) => variant.startsWith(requested))) return 8;
  if (candidate.variants.some((variant) => variant.includes(requested))) return 9;
  return 99;
}

function writeProfessionalsCache(professionals, branchName) {
  const cacheDir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const payload = {
    cachedAt: new Date().toISOString(),
    branch: branchName || DEFAULT_BRANCH_NAME,
    professionals,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`CACHE_SAVED ${professionals.length} professionals -> ${CACHE_FILE}`);
}

function buildPatientReply(professional, specialty, slots) {
  if (!slots.length) {
    return [
      `No encontre disponibilidad visible con ${professional || 'la busqueda solicitada'}${specialty ? ` en ${specialty}` : ''}.`,
      'Te ingreso la direccion debido a que debes ingresar datos privados y confirmar en tu bandeja de email privado.',
      `URL: ${AGENDA_URL}`,
      'Gracias',
    ].join(' ');
  }

  return [
    `Tengo estas horas disponibles con ${professional}${specialty ? ` en ${specialty}` : ''}:`,
    ...slots.map((slot, i) => `${i + 1}- ${slot.date} a las ${slot.time}`),
    `${slots.length + 1}- Salir`,
    '',
    'Elige el número de la hora que prefieres para agendar.',
  ].join('\n');
}

async function waitForProfessionalResults(page) {
  const list = page.locator('ul.doctor-professional-results');
  await list.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const loader = document.querySelector('#profesional-result-loader');
    const rows = document.querySelectorAll('ul.doctor-professional-results li.fila-profesional');
    const loaderVisible = !!loader && getComputedStyle(loader).display !== 'none';
    return !loaderVisible && rows.length > 0;
  }, undefined, { timeout: 15000 });
}

async function waitForCalendar(page) {
  await page.locator('#div_picker').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell'));
    return cells.some((cell) => {
      const html = cell;
      const text = (html.textContent || '').trim();
      return /^\d+$/.test(text) && !/disabled|date-disabled|not-notable/i.test(html.className || '');
    });
  }, undefined, { timeout: 15000 });
}

async function readVisibleCalendarTables(page) {
  return page.locator('.table-horarios').evaluateAll((tables) => {
    return tables
      .map((table) => {
        const element = table;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        const times = Array.from(table.querySelectorAll('button.btn-reservar[data-hora]'))
          .map((button) => button.getAttribute('data-hora') || '')
          .filter(Boolean);

        return { visible, dataDia: element.getAttribute('data-dia') || '', times };
      })
      .filter((table) => table.visible && table.dataDia && table.times.length)
      .map(({ dataDia, times }) => ({ dataDia, times }));
  }).catch(() => []);
}

async function readActiveCalendarTable(page) {
  const tables = await readVisibleCalendarTables(page);
  return tables[0] || { dataDia: '', times: [] };
}

async function main() {
  const rut = process.env.MEDINET_RUT;
  const query = process.env.MEDINET_QUERY;
  const patientMessage = process.env.MEDINET_PATIENT_MESSAGE || '';
  const patientPhone = process.env.MEDINET_PATIENT_PHONE || '';
  const branchName = DEFAULT_BRANCH_NAME;
  const headed = process.env.MEDINET_HEADED !== 'false';

  if (!rut || !query) {
    throw new Error('Define MEDINET_RUT y MEDINET_QUERY para ejecutar este flujo.');
  }

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();

  try {
    await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded' });

    const bookingRunInput = page.locator('#agendar #step-0 input[name="run"]').first();
    await bookingRunInput.fill(rut);
    await bookingRunInput.dispatchEvent('input');
    await bookingRunInput.dispatchEvent('change');

    const branchSelect = page.locator('#ubicacion');
    const branchOptions = await branchSelect.locator('option').evaluateAll((options) => {
      return options
        .map((option) => ({
          value: option.value,
          label: (option.textContent || '').trim(),
        }))
        .filter((option) => option.value && option.label);
    });

    const selectedBranch = branchOptions.find((option) => normalizeText(option.label) === normalizeText(branchName))
      || branchOptions.find((option) => normalizeText(option.label).includes(normalizeText(branchName)));

    if (!selectedBranch) {
      throw new Error(`No encontre la sucursal ${branchName}`);
    }

    await branchSelect.selectOption(selectedBranch.value);
    await branchSelect.dispatchEvent('change');

    const nextButton = page.locator('#agendar #step-0 #btn-step-one');
    await nextButton.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('#agendar #step-0 #btn-step-one');
      return !!button && !button.hasAttribute('disabled');
    }, undefined, { timeout: 10000 });
    await nextButton.click();

    await page.locator('a[href="#profesional-tab"]').click();
    await waitForProfessionalResults(page);

    const memory = await page.locator('ul.doctor-professional-results').evaluate((list) => {
      const rows = Array.from(list.querySelectorAll('li.fila-profesional'));
      return {
        html: list.outerHTML,
        text: (list.textContent || '').replace(/\s+/g, ' ').trim(),
        professionals: rows.map((row) => {
          const getText = (selector) => (row.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
          const reserveButton = row.querySelector('button.btn-option');
          const name = reserveButton?.getAttribute('profesional-name') || row.getAttribute('data-nombre-profesional') || getText('.doctor-title');
          const specialty = reserveButton?.getAttribute('profesional-especialidad') || getText('.doctor-title strong');
          const specialtyId = reserveButton?.getAttribute('profesional-especialidad_id') || '';
          const alertText = getText('.doctor-alert');
          const img = row.querySelector('img');
          return {
            id: row.getAttribute('data-id-profesional') || '',
            name,
            specialty,
            specialtyId,
            tipocita: row.getAttribute('data-tipocita') || '',
            duracion: row.getAttribute('data-duracion') || '',
            alert_text: alertText,
            avatarUrl: img?.getAttribute('src') || '',
            text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
          };
        }),
      };
    });

    // Always save professionals to cache
    writeProfessionalsCache(memory.professionals, branchName);

    const candidates = memory.professionals.map((candidate) => ({
      ...candidate,
      variants: buildVariants(candidate.name, candidate.specialty),
    }));

    const bestCandidate = [...candidates]
      .sort((left, right) => candidatePriority(left, query) - candidatePriority(right, query))[0];

    if (!bestCandidate || candidatePriority(bestCandidate, query) >= 99) {
      throw new Error(`No encontre match real para ${query}`);
    }

    const targetRow = page.locator(`li.fila-profesional[data-id-profesional="${bestCandidate.id}"]`).first();
    await targetRow.locator('button.other-options.btn').click();

    await waitForCalendar(page);
    await page.waitForTimeout(800);

    const availableDayIndices = await page.locator('#div_picker li.days-cell.cell').evaluateAll((cells) => {
      return cells
        .map((cell, index) => ({
          index,
          className: cell.className || '',
          text: (cell.textContent || '').trim(),
        }))
        .filter((item) => /^\d+$/.test(item.text) && !/disabled|date-disabled|not-notable/i.test(item.className))
        .map((item) => item.index);
    });

    const selectedDayIndex = await page.locator('#div_picker li.days-cell.cell.selected, #div_picker li.days-cell.cell.selected-date').evaluate((cell) => {
      if (!cell) return -1;
      const cells = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell'));
      return cells.indexOf(cell);
    }).catch(() => -1);

    const prioritizedIndices = [
      ...availableDayIndices.filter((index) => index !== selectedDayIndex),
      ...availableDayIndices.filter((index) => index === selectedDayIndex),
    ];

    const slots = [];
    const seenSlotKeys = new Set();

    for (const index of prioritizedIndices) {
      if (slots.length >= MAX_SLOTS) break;

      const dayCell = page.locator('#div_picker li.days-cell.cell').nth(index);
      await dayCell.scrollIntoViewIfNeeded().catch(() => {});
      const previousHiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
      const previousDateLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent().catch(() => ''));
      const previousActiveTable = await readActiveCalendarTable(page);
      await dayCell.click({ force: true });

      await page.waitForFunction(({ dayIndex, previousHiddenDateValue, previousDateLabelValue, previousActiveDataDiaValue, previousTimesValue }) => {
        const hiddenInput = document.querySelector('#dia_hidden');
        const hiddenDate = hiddenInput?.value || '';
        const dateLabel = ((document.querySelector('#dia-fecha')?.textContent) || '').replace(/\s+/g, ' ').trim();
        const selectedCell = document.querySelector('#div_picker li.days-cell.cell.selected, #div_picker li.days-cell.cell.selected-date');
        const selectedIndex = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell')).indexOf(selectedCell);
        const visibleTables = Array.from(document.querySelectorAll('.table-horarios'))
          .map((table) => {
            const element = table;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            return visible ? element : null;
          })
          .filter(Boolean);
        const activeTable = visibleTables[0] || null;
        const activeDate = activeTable?.getAttribute('data-dia') || '';
        const visibleTimes = Array.from((activeTable || document).querySelectorAll('button.btn-reservar[data-hora]'))
          .map((button) => {
            const element = button;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            return visible ? element.getAttribute('data-hora') || '' : '';
          })
          .filter(Boolean);

        const timeChanged = JSON.stringify(visibleTimes) !== JSON.stringify(previousTimesValue || []);
        const dayChanged = selectedIndex === Number(dayIndex);
        const dateChanged = hiddenDate !== String(previousHiddenDateValue || '')
          || dateLabel !== String(previousDateLabelValue || '')
          || activeDate !== String(previousActiveDataDiaValue || '');
        return dayChanged && (dateChanged || timeChanged);
      }, {
        dayIndex: index,
        previousHiddenDateValue: previousHiddenDate,
        previousDateLabelValue: previousDateLabel,
        previousActiveDataDiaValue: previousActiveTable.dataDia,
        previousTimesValue: previousActiveTable.times,
      }, { timeout: 10000 }).catch(() => {});

      await page.waitForTimeout(1000);

      const dateLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent());
      const hiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
      const activeTable = await readActiveCalendarTable(page);
      const activeDate = activeTable.dataDia || hiddenDate;
      if (!activeDate && !dateLabel) continue;
      if (activeDate === previousActiveTable.dataDia && dateLabel === previousDateLabel && index !== selectedDayIndex) continue;

      const date = isoToDisplayDate(activeDate) || isoToDisplayDate(hiddenDate) || dateLabel;
      if (!date) continue;

      const visibleTimes = (activeTable.times || [])
        .map((value) => normalizeSpaces(value))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es'));

      if (!visibleTimes.length) continue;

      for (const time of visibleTimes) {
        if (slots.length >= MAX_SLOTS) break;

        const slotKey = `${activeDate || hiddenDate || date}|${time}`;
        if (seenSlotKeys.has(slotKey)) continue;
        seenSlotKeys.add(slotKey);

        slots.push({
          date,
          time,
          dataDia: activeDate,
          booking_url: AGENDA_URL,
          professional: bestCandidate.name,
          professionalId: bestCandidate.id,
          specialty: bestCandidate.specialty,
          alert_text: bestCandidate.alert_text,
          label: `${date} ${time}`,
        });
      }
    }

    const antoniaResponse = {
      source: 'antonia_ayudando_a_agendar_via_web_contactar',
      specialty: bestCandidate.specialty,
      professional: bestCandidate.name,
      first_available: null,
      available_slots: slots,
      patient_reply: buildPatientReply(bestCandidate.name, bestCandidate.specialty, slots),
      patient_phone: patientPhone,
    };

    console.log('MATCHED_PROFESSIONAL', JSON.stringify({
      id: bestCandidate.id,
      professional: bestCandidate.name,
      specialty: bestCandidate.specialty,
    }, null, 2));
    console.log('ANTONIA_RESPONSE', JSON.stringify(antoniaResponse, null, 2));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function bookSlot() {
  const rut = process.env.MEDINET_RUT;
  const professionalId = process.env.MEDINET_PROFESSIONAL_ID;
  const slotDate = process.env.MEDINET_SLOT_DATE;
  const slotTime = process.env.MEDINET_SLOT_TIME;
  const branchName = DEFAULT_BRANCH_NAME;
  const headed = process.env.MEDINET_HEADED !== 'false';

  const patientNombres = process.env.MEDINET_PATIENT_NOMBRES || '';
  const patientApPaterno = process.env.MEDINET_PATIENT_AP_PATERNO || '';
  const patientApMaterno = process.env.MEDINET_PATIENT_AP_MATERNO || '';
  const patientPrevision = process.env.MEDINET_PATIENT_PREVISION || '';
  const patientNacimiento = process.env.MEDINET_PATIENT_NACIMIENTO || '';
  const patientEmail = process.env.MEDINET_PATIENT_EMAIL || '';
  const patientFono = process.env.MEDINET_PATIENT_FONO || '';
  const patientDireccion = process.env.MEDINET_PATIENT_DIRECCION || '';

  if (!rut || !professionalId || !slotDate || !slotTime) {
    throw new Error('Define MEDINET_RUT, MEDINET_PROFESSIONAL_ID, MEDINET_SLOT_DATE, MEDINET_SLOT_TIME.');
  }

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();

  try {
    // Step 1: Navigate and enter RUT
    await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded' });

    const bookingRunInput = page.locator('#agendar #step-0 input[name="run"]').first();
    await bookingRunInput.fill(rut);
    await bookingRunInput.dispatchEvent('input');
    await bookingRunInput.dispatchEvent('change');

    // Step 2: Select branch
    const branchSelect = page.locator('#ubicacion');
    const branchOptions = await branchSelect.locator('option').evaluateAll((options) => {
      return options
        .map((option) => ({ value: option.value, label: (option.textContent || '').trim() }))
        .filter((option) => option.value && option.label);
    });

    const selectedBranch = branchOptions.find((option) => normalizeText(option.label) === normalizeText(branchName))
      || branchOptions.find((option) => normalizeText(option.label).includes(normalizeText(branchName)));

    if (!selectedBranch) throw new Error(`No encontre la sucursal ${branchName}`);

    await branchSelect.selectOption(selectedBranch.value);
    await branchSelect.dispatchEvent('change');

    // Step 3: Click next
    const nextButton = page.locator('#agendar #step-0 #btn-step-one');
    await nextButton.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('#agendar #step-0 #btn-step-one');
      return !!button && !button.hasAttribute('disabled');
    }, undefined, { timeout: 10000 });
    await nextButton.click();

    // Step 4: Go to professional tab and find the professional
    await page.locator('a[href="#profesional-tab"]').click();
    await waitForProfessionalResults(page);

    const targetRow = page.locator(`li.fila-profesional[data-id-profesional="${professionalId}"]`).first();
    await targetRow.locator('button.other-options.btn').click();

    // Step 5: Wait for calendar and select the correct date
    await waitForCalendar(page);
    await page.waitForTimeout(800);

    // Find and click the day cell that corresponds to slotDate
    const targetDayIndex = await page.evaluate((targetDate) => {
      const tables = Array.from(document.querySelectorAll('.table-horarios'));
      for (const table of tables) {
        if (table.getAttribute('data-dia') === targetDate) {
          return -2; // already visible
        }
      }
      const cells = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell'));
      for (let i = 0; i < cells.length; i++) {
        const text = (cells[i].textContent || '').trim();
        if (/^\d+$/.test(text) && !/disabled|date-disabled|not-notable/i.test(cells[i].className || '')) {
          return i;
        }
      }
      return -1;
    }, slotDate);

    // Click through calendar days to find the right date
    const daysCells = page.locator('#div_picker li.days-cell.cell');
    const dayCount = await daysCells.count();
    let dateFound = false;

    for (let i = 0; i < dayCount; i++) {
      const cell = daysCells.nth(i);
      const className = await cell.getAttribute('class').catch(() => '');
      const text = normalizeSpaces(await cell.textContent().catch(() => ''));

      if (!(/^\d+$/.test(text)) || /disabled|date-disabled|not-notable/i.test(className || '')) continue;

      await cell.scrollIntoViewIfNeeded().catch(() => {});
      await cell.click({ force: true });
      await page.waitForTimeout(1200);

      const activeTable = await readActiveCalendarTable(page);
      if (activeTable.dataDia === slotDate) {
        dateFound = true;
        break;
      }
    }

    if (!dateFound) {
      // Try checking if the date is already active
      const activeTable = await readActiveCalendarTable(page);
      if (activeTable.dataDia !== slotDate) {
        throw new Error(`No se encontro la fecha ${slotDate} en el calendario.`);
      }
    }

    // Step 6: Click the "Reservar" button for the selected time
    const reservarButton = page.locator(`button.btn-reservar[data-hora="${slotTime}"]`).first();
    await reservarButton.waitFor({ state: 'visible', timeout: 10000 });
    await reservarButton.click();

    // Step 7: Wait for the booking form to appear
    await page.waitForTimeout(2000);

    const selectAnyAppointmentType = async () => {
      const appointmentType = page.locator('#id_appointment_type:visible').first();
      const isVisible = await appointmentType.isVisible().catch(() => false);
      if (!isVisible) return false;
      await appointmentType.evaluate((select) => {
        const options = Array.from(select.querySelectorAll('option'));
        const firstValid = options.find((o) => o.value && !o.disabled);
        if (firstValid) {
          select.value = firstValid.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      return true;
    };
    const fillIfVisible = async (selector, value) => {
      if (!value) return false;
      const locator = page.locator(`${selector}:visible`).first();
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) return false;
      await locator.fill(value);
      return true;
    };
    const selectIfVisible = async (selector, value) => {
      const locator = page.locator(`${selector}:visible`).first();
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) return false;
      await locator.selectOption(value);
      return true;
    };

    // Step 8: Select any valid appointment type option
    await selectAnyAppointmentType();

    await page.waitForTimeout(500);

    const isCompactStoredPatientForm = await page.evaluate(() => {
      const visible = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
      };

      return visible('#id_appointment_type')
        && visible('#paciente_rut[disabled]')
        && visible('#paciente_email')
        && visible('#paciente_fono')
        && !visible('#paciente_nombres')
        && !visible('#paciente_ap_paterno')
        && !visible('#paciente_ap_materno')
        && !visible('#paciente_sexo')
        && !visible('#paciente_prevision')
        && !visible('#paciente_nacimiento')
        && !visible('#paciente_direccion');
    });

    if (isCompactStoredPatientForm) {
      await fillIfVisible('#paciente_email', patientEmail);
      await fillIfVisible('#paciente_fono', patientFono);
      return;
    }

    // Step 9: Fill in patient data
    await fillIfVisible('#paciente_nombres', patientNombres);
    await fillIfVisible('#paciente_ap_paterno', patientApPaterno);
    await fillIfVisible('#paciente_ap_materno', patientApMaterno);

    // Sexo: always "Indeterminado" (value=3)
    await selectIfVisible('#paciente_sexo', '3');

    // Prevision/Aseguradora
    if (patientPrevision) {
      const previsionOptions = await page.locator('#paciente_prevision option').evaluateAll((options) => {
        return options.map((o) => ({ value: o.value, label: (o.textContent || '').trim().toUpperCase() })).filter((o) => o.value);
      });
      const matchedPrevision = previsionOptions.find((o) => o.label === patientPrevision.toUpperCase())
        || previsionOptions.find((o) => o.label.includes(patientPrevision.toUpperCase()));
      if (matchedPrevision) {
        await selectIfVisible('#paciente_prevision', matchedPrevision.value);
      }
    }

    // Fecha de nacimiento
    if (patientNacimiento) {
      const nacimientoLocator = page.locator('#paciente_nacimiento:visible').first();
      const nacimientoVisible = await nacimientoLocator.isVisible().catch(() => false);
      if (nacimientoVisible) {
        await nacimientoLocator.evaluate((input, dob) => {
          input.removeAttribute('readonly');
          input.value = dob;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, patientNacimiento);
      }
    }

    // Email
    await fillIfVisible('#paciente_email', patientEmail);

    // Telefono
    await fillIfVisible('#paciente_fono', patientFono);

    // Direccion
    await fillIfVisible('#paciente_direccion', patientDireccion);

    // Step 10: Click ENVIAR
    await page.locator('button.btn-comprobar-cita').click();

    // Step 11: Wait 3 seconds for validation screen
    await page.waitForTimeout(3000);

    // Step 12: Click CONFIRMAR RESERVA
    const confirmarButton = page.locator('button.btn.btn-confirmar[onclick="controlStepper(4, 0)"]:visible').first();
    const hasConfirmButton = await confirmarButton.isVisible().catch(() => false);
    if (hasConfirmButton) {
      await confirmarButton.click();
    } else {
      const fallbackButton = page.locator('button:visible:not(.btn-volver)').filter({
        hasNotText: 'Volver',
      }).first();
      const hasFallbackButton = await fallbackButton.isVisible().catch(() => false);
      if (!hasFallbackButton) {
        throw new Error('No apareció un botón util para confirmar reserva.');
      }
      await fallbackButton.click();
    }

    // Step 13: Wait for success screen
    await page.waitForTimeout(3000);

    // Step 14: Check for success message
    const successResult = await page.evaluate(() => {
      const successDiv = document.querySelector('.validacion-completada');
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const explicitError = /ocurri[oó] un error|por favor intenta nuevamente|volver/i.test(bodyText);
      if (!successDiv) {
        return {
          success: false,
          message: explicitError ? 'La pagina mostro un error al confirmar la reserva.' : 'No se encontro pantalla de confirmacion.'
        };
      }

      const style = getComputedStyle(successDiv);
      if (style.display === 'none' || style.visibility === 'hidden' || successDiv.getBoundingClientRect().height === 0) {
        return {
          success: false,
          message: explicitError ? 'La pagina mostro un error al confirmar la reserva.' : 'Pantalla de confirmacion no visible.'
        };
      }

      const subtitle = (successDiv.querySelector('.validacion-completada-subtitle')?.textContent || '').trim();
      const emailSpan = (successDiv.querySelector('#email-text')?.textContent || '').trim();

      return {
        success: !explicitError && (subtitle.includes('reserva se ha realizado con éxito') || subtitle.includes('reserva se ha realizado con exito')),
        message: subtitle,
        emailSent: emailSpan
      };
    });

    // Step 15: Click TERMINAR
    await page.locator('button.btn-primary[onclick="controlStepper(0, 0)"]').click().catch(() => {});

    const apiBookingAccepted = false;
    const bookingResponse = {
      source: 'antonia_booking_completed',
      success: successResult.success || apiBookingAccepted,
      message: successResult.message,
      emailSent: successResult.emailSent || '',
      apiBookingAccepted,
      slotDate,
      slotTime,
      patient_reply: (successResult.success || apiBookingAccepted)
        ? 'Tu cita ha sido agendada con éxito. Revisa tu email para la confirmación. Gracias.'
        : `Hubo un problema al confirmar la reserva: ${successResult.message}. Por favor intenta directamente en ${AGENDA_URL}`,
    };

    console.log('ANTONIA_RESPONSE', JSON.stringify(bookingResponse, null, 2));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function cacheAllProfessionals() {
  const rut = process.env.MEDINET_RUT;
  const branchName = DEFAULT_BRANCH_NAME;
  const headed = process.env.MEDINET_HEADED !== 'false';

  if (!rut) throw new Error('Define MEDINET_RUT para ejecutar cache.');

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();

  try {
    await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded' });

    const bookingRunInput = page.locator('#agendar #step-0 input[name="run"]').first();
    await bookingRunInput.fill(rut);
    await bookingRunInput.dispatchEvent('input');
    await bookingRunInput.dispatchEvent('change');

    const branchSelect = page.locator('#ubicacion');
    const branchOptions = await branchSelect.locator('option').evaluateAll((options) => {
      return options
        .map((option) => ({ value: option.value, label: (option.textContent || '').trim() }))
        .filter((option) => option.value && option.label);
    });

    const selectedBranch = branchOptions.find((option) => normalizeText(option.label) === normalizeText(branchName))
      || branchOptions.find((option) => normalizeText(option.label).includes(normalizeText(branchName)));

    if (!selectedBranch) throw new Error(`No encontre la sucursal ${branchName}`);

    await branchSelect.selectOption(selectedBranch.value);
    await branchSelect.dispatchEvent('change');

    const nextButton = page.locator('#agendar #step-0 #btn-step-one');
    await nextButton.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('#agendar #step-0 #btn-step-one');
      return !!button && !button.hasAttribute('disabled');
    }, undefined, { timeout: 10000 });
    await nextButton.click();

    await page.locator('a[href="#profesional-tab"]').click();
    await waitForProfessionalResults(page);

    const professionals = await page.locator('ul.doctor-professional-results').evaluate((list) => {
      const rows = Array.from(list.querySelectorAll('li.fila-profesional'));
      return rows.map((row) => {
        const getText = (selector) => (row.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
        const reserveButton = row.querySelector('button.btn-option');
        const name = reserveButton?.getAttribute('profesional-name') || row.getAttribute('data-nombre-profesional') || getText('.doctor-title');
        const specialty = reserveButton?.getAttribute('profesional-especialidad') || getText('.doctor-title strong');
        const specialtyId = reserveButton?.getAttribute('profesional-especialidad_id') || '';
        const alertText = getText('.doctor-alert');
        const img = row.querySelector('img');
        return {
          id: row.getAttribute('data-id-profesional') || '',
          name,
          specialty,
          specialtyId,
          tipocita: row.getAttribute('data-tipocita') || '',
          duracion: row.getAttribute('data-duracion') || '',
          alert_text: alertText,
          avatarUrl: img?.getAttribute('src') || '',
        };
      });
    });

    writeProfessionalsCache(professionals, branchName);

    const cacheResponse = {
      source: 'antonia_cache_professionals',
      cachedAt: new Date().toISOString(),
      branch: branchName,
      count: professionals.length,
      professionals,
    };

    console.log('ANTONIA_RESPONSE', JSON.stringify(cacheResponse, null, 2));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const mode = process.env.MEDINET_MODE || 'search';
const entrypoint = mode === 'book' ? bookSlot : mode === 'cache' ? cacheAllProfessionals : main;

entrypoint().catch((error) => {
  console.error('MEDINET_ANTONIA_ERROR', error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
