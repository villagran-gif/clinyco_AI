import { expect, test } from '@playwright/test';

type Slot = {
  date: string;
  time: string;
  dataDia: string;
  booking_url: string;
  professional: string;
  professionalId: string;
  specialty: string;
  alert_text: string;
  label: string;
};

type Candidate = {
  id: string;
  name: string;
  specialty: string;
  alert_text: string;
  variants: string[];
  text: string;
};

type AntoniaResponse = {
  source: string;
  specialty: string;
  professional: string;
  first_available: null;
  available_slots: Slot[];
  patient_reply: string;
  patient_phone: string;
};

const AGENDA_URL = 'https://clinyco.medinetapp.com/agendaweb/planned/';
const DEFAULT_BRANCH_NAME = process.env.MEDINET_BRANCH_NAME || 'Antofagasta Mall Arauco Express';
const MAX_SLOTS = 6;

function normalizeSpaces(value = ''): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value = ''): string {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isoToDisplayDate(value = ''): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function pickRandomItem<T>(items: T[]): T | null {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function buildVariants(name = '', specialty = ''): string[] {
  const variants = new Set<string>();
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

function candidatePriority(candidate: Candidate, query: string): number {
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

function buildPatientReply(professional: string, specialty: string, slots: Slot[]): string {
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
    ...slots.map((slot) => `- ${slot.date} a las ${slot.time}`),
    '',
    'Te ingreso la direccion debido a que debes ingresar datos privados y confirmar en tu bandeja de email privado.',
    `URL: ${AGENDA_URL}`,
    'Gracias',
  ].join('\n');
}

async function waitForProfessionalResults(page: Parameters<typeof test>[1] extends never ? never : any) {
  const list = page.locator('ul.doctor-professional-results');
  await expect(list).toBeVisible({ timeout: 15000 });

  await page.waitForFunction(() => {
    const loader = document.querySelector('#profesional-result-loader') as HTMLElement | null;
    const rows = document.querySelectorAll('ul.doctor-professional-results li.fila-profesional');
    const loaderVisible = !!loader && getComputedStyle(loader).display !== 'none';
    return !loaderVisible && rows.length > 0;
  }, undefined, { timeout: 15000 });
}

async function waitForCalendar(page: Parameters<typeof test>[1] extends never ? never : any) {
  await expect(page.locator('#div_picker')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell'));
    return cells.some((cell) => {
      const html = cell as HTMLElement;
      const text = (html.textContent || '').trim();
      return /^\d+$/.test(text) && !/disabled|date-disabled|not-notable/i.test(html.className || '');
    });
  }, undefined, { timeout: 15000 });
}

async function readVisibleCalendarTables(page: Parameters<typeof test>[1] extends never ? never : any): Promise<Array<{ dataDia: string; times: string[] }>> {
  return page.locator('.table-horarios').evaluateAll((tables) => {
    return tables
      .map((table) => {
        const element = table as HTMLElement;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        const times = Array.from(table.querySelectorAll('button.btn-reservar[data-hora]'))
          .map((button) => (button as HTMLElement).getAttribute('data-hora') || '')
          .filter(Boolean);

        return {
          visible,
          dataDia: element.getAttribute('data-dia') || '',
          times,
        };
      })
      .filter((table) => table.visible && table.dataDia && table.times.length)
      .map(({ dataDia, times }) => ({ dataDia, times }));
  }).catch(() => []);
}

async function readActiveCalendarTable(page: Parameters<typeof test>[1] extends never ? never : any): Promise<{ dataDia: string; times: string[] }> {
  const tables = await readVisibleCalendarTables(page);
  return tables[0] || { dataDia: '', times: [] };
}

test('flujo Medinet Antonia por profesional o especialidad', async ({ page }) => {
  test.setTimeout(120000);

  const rut = process.env.MEDINET_RUT;
  const query = process.env.MEDINET_QUERY;
  const patientMessage = process.env.MEDINET_PATIENT_MESSAGE || '';
  const patientPhone = process.env.MEDINET_PATIENT_PHONE || '';
  const branchName = DEFAULT_BRANCH_NAME;

  test.skip(!rut || !query, 'Define MEDINET_RUT y MEDINET_QUERY para ejecutar este flujo.');

  await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded' });

  const bookingRunInput = page.locator('#agendar #step-0 input[name="run"]').first();
  await bookingRunInput.fill(rut!);
  await bookingRunInput.dispatchEvent('input');
  await bookingRunInput.dispatchEvent('change');

  const branchSelect = page.locator('#ubicacion');
  const branchOptions = await branchSelect.locator('option').evaluateAll((options) => {
    return options
      .map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: (option.textContent || '').trim(),
      }))
      .filter((option) => option.value && option.label);
  });

  const selectedBranch = branchOptions.find((option) => normalizeText(option.label) === normalizeText(branchName))
    || branchOptions.find((option) => normalizeText(option.label).includes(normalizeText(branchName)));

  expect(selectedBranch, `No encontre la sucursal ${branchName}`).toBeTruthy();
  await branchSelect.selectOption(selectedBranch!.value);
  await branchSelect.dispatchEvent('change');

  const nextButton = page.locator('#agendar #step-0 #btn-step-one');
  await expect(nextButton).toBeEnabled({ timeout: 10000 });
  await nextButton.click();

  await page.locator('a[href="#profesional-tab"]').click();
  await waitForProfessionalResults(page);

  const memory = await page.locator('ul.doctor-professional-results').evaluate((list) => {
    const rows = Array.from(list.querySelectorAll('li.fila-profesional'));
    return {
      html: (list as HTMLElement).outerHTML,
      text: (list.textContent || '').replace(/\s+/g, ' ').trim(),
      professionals: rows.map((row) => {
        const getText = (selector: string) => (row.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
        const reserveButton = row.querySelector('button.btn-option');
        const name = reserveButton?.getAttribute('profesional-name') || row.getAttribute('data-nombre-profesional') || getText('.doctor-title');
        const specialty = reserveButton?.getAttribute('profesional-especialidad') || getText('.doctor-title strong');
        const alertText = getText('.doctor-alert');
        return {
          id: row.getAttribute('data-id-profesional') || '',
          name,
          specialty,
          alert_text: alertText,
          text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      }),
    };
  });

  const candidates: Candidate[] = memory.professionals.map((candidate) => ({
    ...candidate,
    variants: buildVariants(candidate.name, candidate.specialty),
  }));

  const bestCandidate = [...candidates]
    .sort((left, right) => candidatePriority(left, query!) - candidatePriority(right, query!))[0];

  expect(bestCandidate && candidatePriority(bestCandidate, query!) < 99, `No encontre match real para ${query}`).toBeTruthy();

  const targetRow = page.locator(`li.fila-profesional[data-id-profesional="${bestCandidate.id}"]`).first();
  await targetRow.locator('button.other-options.btn').click();

  await waitForCalendar(page);
  await page.waitForTimeout(800);

  const calendarState = await page.locator('#div_picker').evaluate((picker) => {
    const cells = Array.from(picker.querySelectorAll('li.days-cell.cell')).map((cell, index) => ({
      index,
      text: (cell.textContent || '').trim(),
      className: (cell as HTMLElement).className || '',
    }));
    const visibleButtons = Array.from(picker.querySelectorAll('.table-horarios button.btn-reservar[data-hora]')).map((button) => ({
      hora: (button as HTMLElement).getAttribute('data-hora') || '',
      text: ((button as HTMLElement).textContent || '').trim(),
    }));
    return { cells, visibleButtons };
  });

  const availableDayIndices = await page.locator('#div_picker li.days-cell.cell').evaluateAll((cells) => {
    return cells
      .map((cell, index) => ({
        index,
        className: (cell as HTMLElement).className || '',
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
  const slots: Slot[] = [];
  const seenSlotKeys = new Set<string>();

  for (const index of prioritizedIndices) {
    if (slots.length >= MAX_SLOTS) break;
    const dayCell = page.locator('#div_picker li.days-cell.cell').nth(index);
    await dayCell.scrollIntoViewIfNeeded().catch(() => {});
    const previousHiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
    const previousDateLabel = (await page.locator('#dia-fecha').textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
    const previousActiveTable = await readActiveCalendarTable(page);
    await dayCell.click({ force: true });

    await page.waitForFunction(({ dayIndex, previousHiddenDateValue, previousDateLabelValue, previousActiveDataDiaValue, previousTimesValue }) => {
      const hiddenInput = document.querySelector('#dia_hidden') as HTMLInputElement | null;
      const hiddenDate = hiddenInput?.value || '';
      const dateLabel = ((document.querySelector('#dia-fecha') as HTMLElement | null)?.textContent || '').replace(/\s+/g, ' ').trim();
      const selectedCell = document.querySelector('#div_picker li.days-cell.cell.selected, #div_picker li.days-cell.cell.selected-date');
      const selectedIndex = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell')).indexOf(selectedCell as Element);
      const visibleTables = Array.from(document.querySelectorAll('.table-horarios'))
        .map((table) => {
          const element = table as HTMLElement;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          return visible ? element : null;
        })
        .filter(Boolean) as HTMLElement[];
      const activeTable = visibleTables[0] || null;
      const activeDate = activeTable?.getAttribute('data-dia') || '';
      const visibleTimes = Array.from((activeTable || document).querySelectorAll('button.btn-reservar[data-hora]'))
        .map((button) => {
          const element = button as HTMLElement;
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

    const dateLabel = (await page.locator('#dia-fecha').textContent() || '').replace(/\s+/g, ' ').trim();
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
        booking_url: AGENDA_URL,
        professional: bestCandidate.name,
        specialty: bestCandidate.specialty,
        alert_text: bestCandidate.alert_text,
        label: `${date} ${time}`,
      });
    }
  }

  const antoniaResponse: AntoniaResponse = {
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

  expect(antoniaResponse.professional).toBeTruthy();
  expect(antoniaResponse.patient_reply).toBeTruthy();
  expect(antoniaResponse.available_slots.length).toBeLessThanOrEqual(MAX_SLOTS);

  if (antoniaResponse.available_slots.length > 0) {
    expect(antoniaResponse.patient_reply).toContain('Tengo estas horas disponibles');
  } else {
    expect(antoniaResponse.patient_reply).toContain('No encontre disponibilidad visible');
  }
});
