const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENDA_URL = 'https://clinyco.medinetapp.com/agendaweb/planned/';
const DEFAULT_BRANCH_NAME = process.env.MEDINET_BRANCH_NAME || 'Antofagasta Mall Arauco Express';
const MAX_SLOTS = 3;
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

function truncateText(value = '', maxLength = 2000) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

async function writeDiagnosticScreenshot(page, label = 'medinet') {
  try {
    const diagnosticsDir = path.join(os.tmpdir(), 'medinet-diagnostics');
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    const screenshotPath = path.join(diagnosticsDir, `${label}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } catch {
    return null;
  }
}

async function collectPageDiagnostic(page, context = {}) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const readyState = await page.evaluate(() => document.readyState).catch(() => 'unavailable');
  const html = await page.content().catch(() => '');
  const domSummary = await page.evaluate(() => {
    const summarizeNode = (element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      name: element.getAttribute('name') || '',
      type: element.getAttribute('type') || '',
      text: ((element.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 120),
    });

    return {
      agendarCount: document.querySelectorAll('#agendar').length,
      runInputCount: document.querySelectorAll('#agendar #step-0 input[name="run"]').length,
      branchSelectCount: document.querySelectorAll('#ubicacion').length,
      nextButtonCount: document.querySelectorAll('#agendar #step-0 #btn-step-one').length,
      bodyClassName: document.body?.className || '',
      bodyTextPreview: ((document.body?.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 400),
      firstInteractiveNodes: Array.from(document.querySelectorAll('input, select, button, form'))
        .slice(0, 12)
        .map(summarizeNode),
    };
  }).catch(() => ({
    agendarCount: -1,
    runInputCount: -1,
    branchSelectCount: -1,
    nextButtonCount: -1,
    bodyClassName: '',
    bodyTextPreview: '',
    firstInteractiveNodes: [],
  }));
  const screenshotPath = await writeDiagnosticScreenshot(page, 'medinet-step1');

  return {
    ...context,
    url,
    title,
    readyState,
    htmlLength: html.length,
    htmlPreview: truncateText(html, 2000),
    screenshotPath,
    ...domSummary,
  };
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
    '',
    'Si deseas agendar, indícame el número de la hora que prefieres y te ayudo a reservar.',
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

async function waitForSlotsVisible(page, timeout = 15000) {
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('.table-horarios button.btn-reservar[data-hora]'));
    return buttons.some((button) => {
      const table = button.closest('.table-horarios');
      if (!table) return false;
      const tableStyle = getComputedStyle(table);
      const buttonStyle = getComputedStyle(button);
      if (tableStyle.display === 'none' || tableStyle.visibility === 'hidden') return false;
      if (buttonStyle.display === 'none' || buttonStyle.visibility === 'hidden') return false;
      return !!button.getAttribute('data-hora');
    });
  }, undefined, { timeout });
}

async function readVisibleCalendarTables(page) {
  return page.locator('.table-horarios').evaluateAll((tables) => {
    return tables
      .map((table) => {
        const element = table;
        const style = getComputedStyle(element);
        const visible = style.display !== 'none' && style.visibility !== 'hidden';
        const times = Array.from(table.querySelectorAll('button.btn-reservar[data-hora]'))
          .map((button) => {
            const buttonStyle = getComputedStyle(button);
            if (buttonStyle.display === 'none' || buttonStyle.visibility === 'hidden') return '';
            return button.getAttribute('data-hora') || '';
          })
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

async function openBookingStepOne(page, rut, branchName) {
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
  } catch (error) {
    const diagnostic = await collectPageDiagnostic(page, {
      stage: 'openBookingStepOne',
      medinetMode: process.env.MEDINET_MODE || 'search',
      branchName,
      errorMessage: error?.message || String(error),
    });
    console.error('MEDINET_PAGE_DIAGNOSTIC', JSON.stringify(diagnostic, null, 2));
    throw error;
  }
}

async function openProfessionalAgenda(page, professionalId) {
  await page.locator('a[href="#profesional-tab"]').click();
  await waitForProfessionalResults(page);

  const targetRow = page.locator(`li.fila-profesional[data-id-profesional="${professionalId}"]`).first();
  await targetRow.waitFor({ state: 'visible', timeout: 15000 });

  const primaryButton = targetRow.locator('button.btn-option').first();
  const fallbackButton = targetRow.locator('button.other-options.btn').first();

  if (await primaryButton.isVisible().catch(() => false)) {
    await primaryButton.click();
  } else {
    await fallbackButton.click();
  }

  await waitForSlotsVisible(page, 20000);
}

async function selectCalendarDate(page, slotDate) {
  let activeTable = await readActiveCalendarTable(page);
  if (activeTable.dataDia === slotDate) return;

  // Try navigating forward up to MAX_WEEK_NAV weeks if the date is not in the current view
  const MAX_WEEK_NAV = 8;

  for (let weekAttempt = 0; weekAttempt <= MAX_WEEK_NAV; weekAttempt++) {
    // Iterate all available day cells in the current picker view (same approach as search flow)
    const dayCells = page.locator('#div_picker li.days-cell.cell');
    const dayCount = await dayCells.count();

    for (let i = 0; i < dayCount; i++) {
      const cell = dayCells.nth(i);
      if (!(await cell.isVisible().catch(() => false))) continue;

      const className = (await cell.getAttribute('class').catch(() => '')) || '';
      const text = normalizeSpaces(await cell.textContent().catch(() => ''));
      if (!/^\d+$/.test(text)) continue;
      if (/disabled|date-disabled|not-notable/i.test(className)) continue;

      const previousHiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
      const previousDateLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent().catch(() => ''));
      const previousActiveTable = await readActiveCalendarTable(page);

      await cell.scrollIntoViewIfNeeded().catch(() => {});
      await cell.click({ force: true });

      // Wait for calendar to update using the same robust detection as the search flow
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
        const activeTableEl = visibleTables[0] || null;
        const activeDate = activeTableEl?.getAttribute('data-dia') || '';
        const visibleTimes = Array.from((activeTableEl || document).querySelectorAll('button.btn-reservar[data-hora]'))
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
        dayIndex: i,
        previousHiddenDateValue: previousHiddenDate,
        previousDateLabelValue: previousDateLabel,
        previousActiveDataDiaValue: previousActiveTable.dataDia,
        previousTimesValue: previousActiveTable.times,
      }, { timeout: 10000 }).catch(() => {});

      await page.waitForTimeout(1000);
      await waitForSlotsVisible(page, 10000).catch(() => {});

      activeTable = await readActiveCalendarTable(page);
      if (activeTable.dataDia === slotDate) return;
    }

    // Date not found in current view — try navigating to the next week
    if (weekAttempt < MAX_WEEK_NAV) {
      const navigated = await navigateCalendarForward(page);
      if (!navigated) break; // No forward button found, stop trying
      await page.waitForTimeout(1500);
      await waitForSlotsVisible(page, 10000).catch(() => {});
    }
  }

  // Collect diagnostic info for debugging
  const allTables = await readVisibleCalendarTables(page);
  const hiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
  const dateLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent().catch(() => ''));
  const availableDates = allTables.map((t) => t.dataDia).join(', ');

  throw new Error(
    `No se encontro la fecha ${slotDate} en el calendario. ` +
    `Fechas visibles: [${availableDates}], hiddenDate: ${hiddenDate}, dateLabel: ${dateLabel}`
  );
}

async function navigateCalendarForward(page) {
  // Try common selectors for "next week/month" navigation buttons in MediNet's date picker
  const nextSelectors = [
    '#div_picker .next',
    '#div_picker .arrow-right',
    '#div_picker .fa-chevron-right',
    '#div_picker .fa-angle-right',
    '#div_picker [class*="next"]',
    '#div_picker [class*="right"]',
    '.picker-nav-next',
    '.datepicker .next',
    '.datepicker .right',
    'button.next-week',
    '[data-action="next"]',
    '#div_picker li.next-arrow',
    '#div_picker .owl-next',
    '#div_picker .slick-next',
  ];

  for (const selector of nextSelectors) {
    const btn = page.locator(selector).first();
    const isVisible = await btn.isVisible().catch(() => false);
    if (isVisible) {
      await btn.click({ force: true }).catch(() => {});
      return true;
    }
  }

  // Fallback: try to find any clickable element that looks like a forward arrow
  const fallbackNav = await page.evaluate(() => {
    const picker = document.querySelector('#div_picker');
    if (!picker) return false;
    const candidates = Array.from(picker.querySelectorAll('a, button, span, li, div'));
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      const cls = (el.className || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (text === '›' || text === '»' || text === '>' || cls.includes('next') || cls.includes('forward') || aria.includes('next')) {
        el.click();
        return true;
      }
    }
    return false;
  });

  return fallbackNav;
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
    await openBookingStepOne(page, rut, branchName);
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

    await openProfessionalAgenda(page, bestCandidate.id);
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
    const seenDates = new Set();

    for (const index of prioritizedIndices) {
      if (slots.length >= MAX_SLOTS) break;

      const dayCell = page.locator('#div_picker li.days-cell.cell').nth(index);
      if (!(await dayCell.isVisible().catch(() => false))) continue;
      await dayCell.scrollIntoViewIfNeeded().catch(() => {});
      const previousHiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
      const previousDateLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent().catch(() => ''));
      const previousActiveTable = await readActiveCalendarTable(page);
      const clicked = await dayCell.click({ force: true }).then(() => true).catch(() => false);
      if (!clicked) continue;

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
      if (!date || seenDates.has(date)) continue;

      const pickedTime = normalizeSpaces(pickRandomItem(activeTable.times) || '');
      if (!pickedTime) continue;

      seenDates.add(date);
      slots.push({
        date,
        time: pickedTime,
        dataDia: activeDate,
        booking_url: AGENDA_URL,
        professional: bestCandidate.name,
        professionalId: bestCandidate.id,
        specialty: bestCandidate.specialty,
        alert_text: bestCandidate.alert_text,
        label: `${date} ${pickedTime}`,
      });
    }

    if (!slots.length) {
      const activeTable = await readActiveCalendarTable(page);
      const fallbackTime = normalizeSpaces(pickRandomItem(activeTable.times) || '');
      const fallbackDate = isoToDisplayDate(activeTable.dataDia || '');
      if (fallbackDate && fallbackTime) {
        slots.push({
          date: fallbackDate,
          time: fallbackTime,
          dataDia: activeTable.dataDia,
          booking_url: AGENDA_URL,
          professional: bestCandidate.name,
          professionalId: bestCandidate.id,
          specialty: bestCandidate.specialty,
          alert_text: bestCandidate.alert_text,
          label: `${fallbackDate} ${fallbackTime}`,
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

  const patientRut = process.env.MEDINET_PATIENT_RUT || '';
  const patientNombres = process.env.MEDINET_PATIENT_NOMBRES || '';
  const patientApPaterno = process.env.MEDINET_PATIENT_AP_PATERNO || '';
  const patientApMaterno = process.env.MEDINET_PATIENT_AP_MATERNO || '';
  const patientPrevision = process.env.MEDINET_PATIENT_PREVISION || '';
  const patientNacimiento = process.env.MEDINET_PATIENT_NACIMIENTO || '';
  const patientEmail = process.env.MEDINET_PATIENT_EMAIL || '';
  const patientFono = process.env.MEDINET_PATIENT_FONO || '';
  const patientDireccion = process.env.MEDINET_PATIENT_DIRECCION || '';
  const bookingStepPauseMs = Number(process.env.MEDINET_BOOK_STEP_PAUSE_MS || 2000);

  if (!rut || !professionalId || !slotDate || !slotTime) {
    throw new Error('Define MEDINET_RUT, MEDINET_PROFESSIONAL_ID, MEDINET_SLOT_DATE, MEDINET_SLOT_TIME.');
  }

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  const pauseStep = async () => {
    if (bookingStepPauseMs > 0) {
      await page.waitForTimeout(bookingStepPauseMs);
    }
  };
  const clickRequestedSlot = async () => {
    const clickedReservar = await page.evaluate(({ requestedDate, requestedTime }) => {
      const tables = Array.from(document.querySelectorAll(`.table-horarios[data-dia="${requestedDate}"]`));
      for (const table of tables) {
        const tableStyle = getComputedStyle(table);
        if (tableStyle.display === 'none' || tableStyle.visibility === 'hidden') continue;
        const buttons = Array.from(table.querySelectorAll('button.btn-reservar[data-hora]'));
        const button = buttons.find((item) => {
          const buttonStyle = getComputedStyle(item);
          return buttonStyle.display !== 'none'
            && buttonStyle.visibility !== 'hidden'
            && (item.getAttribute('data-hora') || '').trim() === requestedTime;
        });
        if (button) {
          button.click();
          return true;
        }
      }
      return false;
    }, { requestedDate: slotDate, requestedTime: slotTime });
    if (!clickedReservar) {
      throw new Error(`No se encontro un boton visible para ${slotDate} ${slotTime}.`);
    }
    await pauseStep();
    await page.waitForTimeout(2000);
    await pauseStep();
  };
  const fillPatientForm = async () => {
    const selectAnyAppointmentType = async () => {
      const appointmentType = page.locator('#id_appointment_type:visible').first();
      const isVisible = await appointmentType.isVisible().catch(() => false);
      if (!isVisible) return false;
      // Get the first valid option value
      const firstValue = await appointmentType.evaluate((select) => {
        const options = Array.from(select.querySelectorAll('option'));
        const firstValid = options.find((o) => o.value && !o.disabled);
        return firstValid ? firstValid.value : null;
      });
      if (firstValue) {
        // Use Playwright's selectOption for reliable event triggering
        await appointmentType.selectOption(firstValue);
        await appointmentType.dispatchEvent('change');
      }
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

    await selectAnyAppointmentType();

    await page.waitForTimeout(500);
    await pauseStep();

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
      await pauseStep();
      return;
    }

    // Fill patient RUT if the field is visible and editable (new patient)
    if (patientRut) {
      const rutField = page.locator('#paciente_rut:visible:not([disabled])').first();
      const rutVisible = await rutField.isVisible().catch(() => false);
      if (rutVisible) {
        await rutField.fill(patientRut);
        await rutField.dispatchEvent('input');
        await rutField.dispatchEvent('change');
        await page.waitForTimeout(500);
      }
    }

    await fillIfVisible('#paciente_nombres', patientNombres);
    await fillIfVisible('#paciente_ap_paterno', patientApPaterno);
    await fillIfVisible('#paciente_ap_materno', patientApMaterno);

    await selectIfVisible('#paciente_sexo', '3');

    if (patientPrevision) {
      const previsionOptions = await page.locator('#paciente_prevision:visible option').evaluateAll((options) => {
        return options.map((o) => ({ value: o.value, label: (o.textContent || '').trim().toUpperCase() })).filter((o) => o.value);
      });
      const matchedPrevision = previsionOptions.find((o) => o.label === patientPrevision.toUpperCase())
        || previsionOptions.find((o) => o.label.includes(patientPrevision.toUpperCase()));
      if (matchedPrevision) {
        await selectIfVisible('#paciente_prevision', matchedPrevision.value);
      }
    }

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

    await fillIfVisible('#paciente_email', patientEmail);
    await fillIfVisible('#paciente_fono', patientFono);
    await fillIfVisible('#paciente_direccion', patientDireccion);
    await pauseStep();
  };

  try {
    await openBookingStepOne(page, rut, branchName);
    await pauseStep();

    await openProfessionalAgenda(page, professionalId);
    await pauseStep();

    await selectCalendarDate(page, slotDate);
    await pauseStep();

    const confirmEvidence = [];
    const onResponse = async (response) => {
      try {
        const request = response.request();
        const method = request.method();
        const url = response.url();
        if (method !== 'POST') return;
        if (!/clinyco\.medinetapp\.com/i.test(url)) return;
        if (/analytics|google-analytics|g\/collect/i.test(url)) return;
        if (!/(agenda|reserv|cita|appointment|medinet)/i.test(url)) return;
        const status = response.status();
        const contentType = (response.headers()['content-type'] || '').toLowerCase();
        let excerpt = '';
        if (contentType.includes('application/json') || contentType.includes('text/')) {
          const text = await response.text().catch(() => '');
          excerpt = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        }
        confirmEvidence.push({ method, status, url, excerpt });
      } catch (_) {
        // noop: best-effort capture
      }
    };
    page.on('response', onResponse);
    let confirmClicked = false;
    let successResult = {
      success: false,
      message: 'No se completo la confirmacion.',
      emailSent: '',
      reservationId: '',
      explicitError: false,
    };
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await clickRequestedSlot();
      await fillPatientForm();

      await page.locator('button.btn-comprobar-cita:visible').first().click();
      await pauseStep();
      await page.waitForTimeout(3000);

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
          const formErrors = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.text-danger, .help-block, .invalid-feedback, .error, .alert-danger'))
              .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean)
              .slice(0, 5);
          }).catch(() => []);
          throw new Error(`No apareció un botón util para confirmar reserva. ${formErrors.length ? `Errores: ${formErrors.join(' | ')}` : ''}`.trim());
        }
        await fallbackButton.click();
      }
      confirmClicked = true;
      await pauseStep();

      await page.waitForTimeout(3000);

      successResult = await page.evaluate(({ expectedEmail }) => {
        const successDiv = document.querySelector('.validacion-completada');
        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        const fallbackSuccess = /reserva se ha realizado con e[xé]ito|reserva confirmada|cita agendada|agendada con e[xé]ito/i.test(bodyText);
        const explicitError = /ocurri[oó] un error|por favor intenta nuevamente/i.test(bodyText);
        const retryButton = document.querySelector('button.btn.btn-primary[onclick="controlStepper(2, 0); loadCupos();"]');
        const retryVisible = !!retryButton && (() => {
          const style = window.getComputedStyle(retryButton);
          return style.display !== 'none' && style.visibility !== 'hidden' && retryButton.getBoundingClientRect().height > 0;
        })();
        const reservationMatch = bodyText.match(/(?:cita|reserva)\s*#?\s*(\d{5,})/i);
        const reservationId = reservationMatch ? reservationMatch[1] : '';

        if (!successDiv) {
          return {
            success: !explicitError && fallbackSuccess,
            message: explicitError
              ? 'La pagina mostro un error al confirmar la reserva.'
              : (fallbackSuccess ? 'Reserva detectada por texto de la página.' : 'No se encontro pantalla de confirmacion.'),
            emailSent: '',
            reservationId,
            explicitError,
            retryVisible,
          };
        }

        const style = window.getComputedStyle(successDiv);
        const successVisible = style.display !== 'none' && style.visibility !== 'hidden' && successDiv.getBoundingClientRect().height > 0;
        const subtitle = (successDiv.querySelector('.validacion-completada-subtitle')?.textContent || '').replace(/\s+/g, ' ').trim();
        const emailSpan = (successDiv.querySelector('#email-text')?.textContent || '').replace(/\s+/g, ' ').trim();
        const successBySubtitle = subtitle.includes('reserva se ha realizado con éxito') || subtitle.includes('reserva se ha realizado con exito');
        const expected = String(expectedEmail || '').trim().toLowerCase();
        const shown = String(emailSpan || '').trim().toLowerCase();
        const successByEmail = !!shown && (!expected || shown === expected);

        return {
          success: !explicitError && successVisible && successBySubtitle && successByEmail && (fallbackSuccess || !!subtitle),
          message: explicitError
            ? 'La pagina mostro un error al confirmar la reserva.'
            : (subtitle || (fallbackSuccess ? 'Reserva detectada por texto de la página.' : 'Pantalla de confirmacion no visible.')),
          emailSent: emailSpan,
          reservationId,
          explicitError,
          retryVisible,
          successVisible,
        };
      }, { expectedEmail: patientEmail });

      if (!successResult.explicitError || !successResult.retryVisible || attempt === maxAttempts) {
        break;
      }

      await page.locator('button.btn.btn-primary[onclick="controlStepper(2, 0); loadCupos();"]:visible').first().click();
      await pauseStep();
      await page.waitForTimeout(3000);
      await selectCalendarDate(page, slotDate);
      await pauseStep();
    }

    page.off('response', onResponse);
    const confirmApiOk = confirmEvidence.some((e) => e.status >= 200 && e.status < 300);

    await page.locator('button.btn-primary[onclick="controlStepper(0, 0)"]:visible').first().click().catch(() => {});

    const reservationIdFromEvidence = (() => {
      for (const ev of confirmEvidence) {
        const match = String(ev.excerpt || '').match(/(?:cita|reserva)?\s*#?\s*(\d{5,})/i);
        if (match) return match[1];
      }
      return '';
    })();
    const apiBookingAccepted = confirmEvidence.some((ev) => {
      return /\/api\/agenda\/citas\/agendaweb-add\//i.test(ev.url || '')
        && ev.status >= 200
        && ev.status < 300
        && /agendado_correctamente/i.test(ev.excerpt || '');
    });
    const finalReservationId = successResult.reservationId || reservationIdFromEvidence;
    const strictSuccess = (successResult.success && confirmApiOk && !!finalReservationId) || apiBookingAccepted;

    const finalMessage = strictSuccess
      ? successResult.message
      : (
        successResult.explicitError
          ? 'La pagina mostro un error al confirmar la reserva.'
          : 'Medinet no devolvio una reserva verificable despues de confirmar.'
      );

    const bookingResponse = {
      source: 'antonia_booking_completed',
      success: strictSuccess,
      message: finalMessage,
      emailSent: successResult.emailSent || '',
      reservationId: finalReservationId,
      confirmClicked,
      confirmApiOk,
      apiBookingAccepted,
      confirmEvidence: confirmEvidence.slice(-6),
      slotDate,
      slotTime,
      patient_reply: strictSuccess
        ? 'Su cita ha sido asignada. Revisar email.'
        : `Hubo un problema al confirmar la reserva: ${finalMessage}. Por favor intenta directamente en ${AGENDA_URL}`,
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
    await openBookingStepOne(page, rut, branchName);
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

async function searchAndBook() {
  const rut = process.env.MEDINET_RUT;
  const professionalId = process.env.MEDINET_PROFESSIONAL_ID;
  const slotDate = process.env.MEDINET_SLOT_DATE;
  const slotTime = process.env.MEDINET_SLOT_TIME;
  const branchName = DEFAULT_BRANCH_NAME;
  const headed = process.env.MEDINET_HEADED !== 'false';

  const patientRut = process.env.MEDINET_PATIENT_RUT || '';
  const patientNombres = process.env.MEDINET_PATIENT_NOMBRES || '';
  const patientApPaterno = process.env.MEDINET_PATIENT_AP_PATERNO || '';
  const patientApMaterno = process.env.MEDINET_PATIENT_AP_MATERNO || '';
  const patientPrevision = process.env.MEDINET_PATIENT_PREVISION || '';
  const patientNacimiento = process.env.MEDINET_PATIENT_NACIMIENTO || '';
  const patientEmail = process.env.MEDINET_PATIENT_EMAIL || '';
  const patientFono = process.env.MEDINET_PATIENT_FONO || '';
  const patientDireccion = process.env.MEDINET_PATIENT_DIRECCION || '';
  const bookingStepPauseMs = Number(process.env.MEDINET_BOOK_STEP_PAUSE_MS || 2000);

  if (!rut || !professionalId || !slotDate || !slotTime) {
    throw new Error('Define MEDINET_RUT, MEDINET_PROFESSIONAL_ID, MEDINET_SLOT_DATE, MEDINET_SLOT_TIME.');
  }

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  const pauseStep = async () => {
    if (bookingStepPauseMs > 0) {
      await page.waitForTimeout(bookingStepPauseMs);
    }
  };

  try {
    // ── Phase 1: Search — navigate to the professional's agenda and find the requested slot ──
    await openBookingStepOne(page, rut, branchName);
    await pauseStep();

    await openProfessionalAgenda(page, professionalId);
    await pauseStep();
    await page.waitForTimeout(1500);

    // Diagnostic: capture full calendar state for debugging
    const calendarDiagnostic = await page.evaluate(() => {
      const allCells = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell'));
      const allTables = Array.from(document.querySelectorAll('.table-horarios'));
      const hiddenInput = document.querySelector('#dia_hidden');
      return {
        pickerExists: !!document.querySelector('#div_picker'),
        totalCells: allCells.length,
        cells: allCells.map((cell, i) => ({
          index: i,
          text: (cell.textContent || '').trim(),
          className: (cell.className || ''),
        })),
        totalTables: allTables.length,
        tables: allTables.map((t) => ({
          dataDia: t.getAttribute('data-dia') || '',
          display: getComputedStyle(t).display,
          visibility: getComputedStyle(t).visibility,
          buttons: t.querySelectorAll('button.btn-reservar[data-hora]').length,
        })),
        hiddenDate: hiddenInput?.value || '',
        dateLabel: (document.querySelector('#dia-fecha')?.textContent || '').trim(),
      };
    }).catch(() => ({ error: 'failed to collect diagnostic' }));
    console.error('SEARCH_AND_BOOK_DIAGNOSTIC', JSON.stringify(calendarDiagnostic, null, 2));

    // Check if the currently active table already has the requested date
    let initialTable = await readActiveCalendarTable(page);
    let slotFound = initialTable.dataDia === slotDate;
    const availableSlots = [];

    console.error('SEARCH_AND_BOOK_INITIAL', JSON.stringify({
      initialDataDia: initialTable.dataDia,
      initialTimes: initialTable.times,
      requestedDate: slotDate,
      requestedTime: slotTime,
      slotFound,
    }));

    if (initialTable.dataDia) {
      availableSlots.push({ dataDia: initialTable.dataDia, times: initialTable.times });
    }

    // If the active table doesn't match the requested date, iterate day cells
    if (!slotFound) {
      const selectedDayIndex = await page.locator('#div_picker li.days-cell.cell.selected, #div_picker li.days-cell.cell.selected-date').evaluate((cell) => {
        if (!cell) return -1;
        const cells = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell'));
        return cells.indexOf(cell);
      }).catch(() => -1);

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

      console.error('SEARCH_AND_BOOK_DAY_INDICES', JSON.stringify({
        selectedDayIndex,
        availableDayIndices,
        totalIndices: availableDayIndices.length,
      }));

      // Prioritize unselected days first (selected day was already read above)
      const prioritizedIndices = [
        ...availableDayIndices.filter((index) => index !== selectedDayIndex),
        ...availableDayIndices.filter((index) => index === selectedDayIndex),
      ];

      for (const index of prioritizedIndices) {
        const dayCell = page.locator('#div_picker li.days-cell.cell').nth(index);
        if (!(await dayCell.isVisible().catch(() => false))) continue;
        await dayCell.scrollIntoViewIfNeeded().catch(() => {});
        const previousHiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
        const previousDateLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent().catch(() => ''));
        const previousActiveTable = await readActiveCalendarTable(page);
        const clicked = await dayCell.click({ force: true }).then(() => true).catch(() => false);
        if (!clicked) continue;

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
          const activeTableEl = visibleTables[0] || null;
          const activeDate = activeTableEl?.getAttribute('data-dia') || '';
          const visibleTimes = Array.from((activeTableEl || document).querySelectorAll('button.btn-reservar[data-hora]'))
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

        const activeTable = await readActiveCalendarTable(page);
        const hiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
        const activeDate = activeTable.dataDia || hiddenDate;

        if (activeDate) {
          availableSlots.push({ dataDia: activeDate, times: activeTable.times });
        }

        if (activeDate === slotDate) {
          slotFound = true;
          break;
        }
      }
    }

    if (!slotFound) {
      const availableDatesInfo = availableSlots.map((s) => `${s.dataDia} [${s.times.join(',')}]`).join('; ');
      throw new Error(
        `No se encontro el slot ${slotDate} ${slotTime} en la agenda del profesional ${professionalId}. ` +
        `Slots disponibles: ${availableDatesInfo || 'ninguno'}`
      );
    }

    // Pause to let the portal settle before booking
    await pauseStep();

    // ── Phase 2: Book — the calendar is already on the correct date, proceed to reserve ──
    const clickRequestedSlot = async () => {
      const clickedReservar = await page.evaluate(({ requestedDate, requestedTime }) => {
        const tables = Array.from(document.querySelectorAll(`.table-horarios[data-dia="${requestedDate}"]`));
        for (const table of tables) {
          const tableStyle = getComputedStyle(table);
          if (tableStyle.display === 'none' || tableStyle.visibility === 'hidden') continue;
          const buttons = Array.from(table.querySelectorAll('button.btn-reservar[data-hora]'));
          const button = buttons.find((item) => {
            const buttonStyle = getComputedStyle(item);
            return buttonStyle.display !== 'none'
              && buttonStyle.visibility !== 'hidden'
              && (item.getAttribute('data-hora') || '').trim() === requestedTime;
          });
          if (button) {
            button.click();
            return true;
          }
        }
        return false;
      }, { requestedDate: slotDate, requestedTime: slotTime });
      if (!clickedReservar) {
        throw new Error(`No se encontro un boton visible para ${slotDate} ${slotTime}.`);
      }
      await pauseStep();
      await page.waitForTimeout(2000);
      await pauseStep();
    };

    const fillPatientForm = async () => {
      const selectAnyAppointmentType = async () => {
        const appointmentType = page.locator('#id_appointment_type:visible').first();
        const isVisible = await appointmentType.isVisible().catch(() => false);
        if (!isVisible) return false;
        const firstValue = await appointmentType.evaluate((select) => {
          const options = Array.from(select.querySelectorAll('option'));
          const firstValid = options.find((o) => o.value && !o.disabled);
          return firstValid ? firstValid.value : null;
        });
        if (firstValue) {
          await appointmentType.selectOption(firstValue);
          await appointmentType.dispatchEvent('change');
        }
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

      await selectAnyAppointmentType();
      await page.waitForTimeout(500);
      await pauseStep();

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
        await pauseStep();
        return;
      }

      if (patientRut) {
        const rutField = page.locator('#paciente_rut:visible:not([disabled])').first();
        const rutVisible = await rutField.isVisible().catch(() => false);
        if (rutVisible) {
          await rutField.fill(patientRut);
          await rutField.dispatchEvent('input');
          await rutField.dispatchEvent('change');
          await page.waitForTimeout(500);
        }
      }

      await fillIfVisible('#paciente_nombres', patientNombres);
      await fillIfVisible('#paciente_ap_paterno', patientApPaterno);
      await fillIfVisible('#paciente_ap_materno', patientApMaterno);
      await selectIfVisible('#paciente_sexo', '3');

      if (patientPrevision) {
        const previsionOptions = await page.locator('#paciente_prevision:visible option').evaluateAll((options) => {
          return options.map((o) => ({ value: o.value, label: (o.textContent || '').trim().toUpperCase() })).filter((o) => o.value);
        });
        const matchedPrevision = previsionOptions.find((o) => o.label === patientPrevision.toUpperCase())
          || previsionOptions.find((o) => o.label.includes(patientPrevision.toUpperCase()));
        if (matchedPrevision) {
          await selectIfVisible('#paciente_prevision', matchedPrevision.value);
        }
      }

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

      await fillIfVisible('#paciente_email', patientEmail);
      await fillIfVisible('#paciente_fono', patientFono);
      await fillIfVisible('#paciente_direccion', patientDireccion);
      await pauseStep();
    };

    const confirmEvidence = [];
    const onResponse = async (response) => {
      try {
        const request = response.request();
        const method = request.method();
        const url = response.url();
        if (method !== 'POST') return;
        if (!/clinyco\.medinetapp\.com/i.test(url)) return;
        if (/analytics|google-analytics|g\/collect/i.test(url)) return;
        if (!/(agenda|reserv|cita|appointment|medinet)/i.test(url)) return;
        const status = response.status();
        const contentType = (response.headers()['content-type'] || '').toLowerCase();
        let excerpt = '';
        if (contentType.includes('application/json') || contentType.includes('text/')) {
          const text = await response.text().catch(() => '');
          excerpt = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        }
        confirmEvidence.push({ method, status, url, excerpt });
      } catch (_) {
        // noop
      }
    };
    page.on('response', onResponse);
    let confirmClicked = false;
    let successResult = {
      success: false,
      message: 'No se completo la confirmacion.',
      emailSent: '',
      reservationId: '',
      explicitError: false,
    };
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await clickRequestedSlot();
      await fillPatientForm();

      await page.locator('button.btn-comprobar-cita:visible').first().click();
      await pauseStep();
      await page.waitForTimeout(3000);

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
          const formErrors = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.text-danger, .help-block, .invalid-feedback, .error, .alert-danger'))
              .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean)
              .slice(0, 5);
          }).catch(() => []);
          throw new Error(`No apareció un botón util para confirmar reserva. ${formErrors.length ? `Errores: ${formErrors.join(' | ')}` : ''}`.trim());
        }
        await fallbackButton.click();
      }
      confirmClicked = true;
      await pauseStep();

      await page.waitForTimeout(3000);

      successResult = await page.evaluate(({ expectedEmail }) => {
        const successDiv = document.querySelector('.validacion-completada');
        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        const fallbackSuccess = /reserva se ha realizado con e[xé]ito|reserva confirmada|cita agendada|agendada con e[xé]ito/i.test(bodyText);
        const explicitError = /ocurri[oó] un error|por favor intenta nuevamente/i.test(bodyText);
        const retryButton = document.querySelector('button.btn.btn-primary[onclick="controlStepper(2, 0); loadCupos();"]');
        const retryVisible = !!retryButton && (() => {
          const style = window.getComputedStyle(retryButton);
          return style.display !== 'none' && style.visibility !== 'hidden' && retryButton.getBoundingClientRect().height > 0;
        })();
        const reservationMatch = bodyText.match(/(?:cita|reserva)\s*#?\s*(\d{5,})/i);
        const reservationId = reservationMatch ? reservationMatch[1] : '';

        if (!successDiv) {
          return {
            success: !explicitError && fallbackSuccess,
            message: explicitError
              ? 'La pagina mostro un error al confirmar la reserva.'
              : (fallbackSuccess ? 'Reserva detectada por texto de la página.' : 'No se encontro pantalla de confirmacion.'),
            emailSent: '',
            reservationId,
            explicitError,
            retryVisible,
          };
        }

        const style = window.getComputedStyle(successDiv);
        const successVisible = style.display !== 'none' && style.visibility !== 'hidden' && successDiv.getBoundingClientRect().height > 0;
        const subtitle = (successDiv.querySelector('.validacion-completada-subtitle')?.textContent || '').replace(/\s+/g, ' ').trim();
        const emailSpan = (successDiv.querySelector('#email-text')?.textContent || '').replace(/\s+/g, ' ').trim();
        const successBySubtitle = subtitle.includes('reserva se ha realizado con éxito') || subtitle.includes('reserva se ha realizado con exito');
        const expected = String(expectedEmail || '').trim().toLowerCase();
        const shown = String(emailSpan || '').trim().toLowerCase();
        const successByEmail = !!shown && (!expected || shown === expected);

        return {
          success: !explicitError && successVisible && successBySubtitle && successByEmail && (fallbackSuccess || !!subtitle),
          message: explicitError
            ? 'La pagina mostro un error al confirmar la reserva.'
            : (subtitle || (fallbackSuccess ? 'Reserva detectada por texto de la página.' : 'Pantalla de confirmacion no visible.')),
          emailSent: emailSpan,
          reservationId,
          explicitError,
          retryVisible,
          successVisible,
        };
      }, { expectedEmail: patientEmail });

      if (!successResult.explicitError || !successResult.retryVisible || attempt === maxAttempts) {
        break;
      }

      await page.locator('button.btn.btn-primary[onclick="controlStepper(2, 0); loadCupos();"]:visible').first().click();
      await pauseStep();
      await page.waitForTimeout(3000);
      await selectCalendarDate(page, slotDate);
      await pauseStep();
    }

    page.off('response', onResponse);
    const confirmApiOk = confirmEvidence.some((e) => e.status >= 200 && e.status < 300);

    await page.locator('button.btn-primary[onclick="controlStepper(0, 0)"]:visible').first().click().catch(() => {});

    const reservationIdFromEvidence = (() => {
      for (const ev of confirmEvidence) {
        const match = String(ev.excerpt || '').match(/(?:cita|reserva)?\s*#?\s*(\d{5,})/i);
        if (match) return match[1];
      }
      return '';
    })();
    const apiBookingAccepted = confirmEvidence.some((ev) => {
      return /\/api\/agenda\/citas\/agendaweb-add\//i.test(ev.url || '')
        && ev.status >= 200
        && ev.status < 300
        && /agendado_correctamente/i.test(ev.excerpt || '');
    });
    const finalReservationId = successResult.reservationId || reservationIdFromEvidence;
    const strictSuccess = (successResult.success && confirmApiOk && !!finalReservationId) || apiBookingAccepted;

    const finalMessage = strictSuccess
      ? successResult.message
      : (
        successResult.explicitError
          ? 'La pagina mostro un error al confirmar la reserva.'
          : 'Medinet no devolvio una reserva verificable despues de confirmar.'
      );

    const bookingResponse = {
      source: 'antonia_search_and_book_completed',
      success: strictSuccess,
      message: finalMessage,
      emailSent: successResult.emailSent || '',
      reservationId: finalReservationId,
      confirmClicked,
      confirmApiOk,
      apiBookingAccepted,
      confirmEvidence: confirmEvidence.slice(-6),
      slotDate,
      slotTime,
      patient_reply: strictSuccess
        ? 'Su cita ha sido asignada. Revisar email.'
        : `Hubo un problema al confirmar la reserva: ${finalMessage}. Por favor intenta directamente en ${AGENDA_URL}`,
    };

    console.log('ANTONIA_RESPONSE', JSON.stringify(bookingResponse, null, 2));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const mode = process.env.MEDINET_MODE || 'search';
const entrypoint = mode === 'book' ? bookSlot : mode === 'search_and_book' ? searchAndBook : mode === 'cache' ? cacheAllProfessionals : main;

entrypoint().catch((error) => {
  console.error('MEDINET_ANTONIA_ERROR', error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
