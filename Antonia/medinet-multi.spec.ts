/**
 * Test parametrizado: prueba múltiples profesionales/especialidades de la agenda web.
 *
 * Uso:
 *   MEDINET_RUT="13580388k" npx playwright test Antonia/medinet-multi.spec.ts
 *
 * Opcional:
 *   MEDINET_BRANCH_NAME="Antofagasta Mall Arauco Express"
 *   MEDINET_HEADED=true          # para ver el navegador
 *
 * Filtrar por test:
 *   npx playwright test Antonia/medinet-multi.spec.ts -g "Villagran"
 *   npx playwright test Antonia/medinet-multi.spec.ts -g "Nutricion"
 */
import { expect, test } from '@playwright/test';

/* ── tipos ── */
type Slot = {
  date: string;
  time: string;
  dataDia: string;
  booking_url: string;
  professional: string;
  professionalId: string;
  specialty: string;
  specialtyId: string;
  alert_text: string;
  label: string;
};
type Candidate = {
  id: string;
  name: string;
  specialty: string;
  specialtyId: string;
  alert_text: string;
  variants: string[];
  text: string;
};

/* ── constantes ── */
const AGENDA_URL = 'https://clinyco.medinetapp.com/agendaweb/planned/';
const DEFAULT_BRANCH_NAME = process.env.MEDINET_BRANCH_NAME || 'Antofagasta Mall Arauco Express';
const MAX_SLOTS = 3;

/* ─────────────  mapa de profesionales (data-id-profesional del HTML)  ───────────── */
const PROF_DB: Record<string, { name: string; specialty: string; specialtyId: string }> = {
  '69':  { name: 'Magaly Cerquera Morales',           specialty: 'Nutrición',                          specialtyId: '5' },
  '8':   { name: 'Peggy Huerta Pizarro',              specialty: 'Psicología',                         specialtyId: '7' },
  '124': { name: 'Francisca Naritelli Vásquez',        specialty: 'Psicología',                         specialtyId: '7' },
  '4':   { name: 'Katherinne Araya Gribell',           specialty: 'Nutriología',                        specialtyId: '6' },
  '44':  { name: 'Ingrid Yevenes Marquez',             specialty: 'Nutriología',                        specialtyId: '6' },
  '12':  { name: 'Pablo Ramos Ruarte',                 specialty: 'Medicina Deportiva',                  specialtyId: '4' },
  '115': { name: 'Carlos Nuñez Godoy',                 specialty: 'Medicina General',                    specialtyId: '53' },
  '140': { name: 'Fernando Luis Moya Mendez Eguiluz',  specialty: 'Nutriología',                        specialtyId: '6' },
  '58':  { name: 'Nelson Aros Mendoza',                specialty: 'Cirugia general y Aparato Digestivo', specialtyId: '1' },
  '13':  { name: 'Rodrigo Villagran Morales',          specialty: 'Cirugia general y Aparato Digestivo', specialtyId: '1' },
  '142': { name: 'Daniza Jaldín Tapia',                specialty: 'Pediatria',                          specialtyId: '56' },
  '70':  { name: 'Katherine Saavedra Bravo',           specialty: 'Nutrición',                          specialtyId: '5' },
  '149': { name: 'Rosirys Ruiz López',                 specialty: 'Cirugia Plastica',                   specialtyId: '54' },
  '5':   { name: 'Sofia Araya Moreno',                 specialty: 'Nutriología',                        specialtyId: '6' },
  '148': { name: 'Edmundo Ziede Rojas',                specialty: 'Cirugia Plastica',                   specialtyId: '54' },
  '79':  { name: 'Alberto Sirabo',                     specialty: 'Cirugia general y Aparato Digestivo', specialtyId: '1' },
  '46':  { name: 'Rodrigo Bancalari Diaz',             specialty: 'Endocrinología Infantil',             specialtyId: '17' },
};

/* ── mapa de especialidades (data-nombre del HTML ul.general-results) ── */
const SPEC_DB: Record<string, string> = {
  '54': 'Cirugia Plastica',
  '1':  'Cirugia general y Aparato Digestivo',
  '19': 'Cirugía Adulto',
  '2':  'Endocrinología Adulto',
  '17': 'Endocrinología Infantil',
  '58': 'Endoscopia / Colonoscopia',
  '13': 'Enfermeria',
  '9':  'Exámenes',
  '3':  'Gastroenterología Adulto',
  '20': 'Gastroenterología Pediatrica',
  '55': 'Hematólogo',
  '11': 'Internista',
  '4':  'Medicina Deportiva',
  '53': 'Medicina General',
  '57': 'Neurocirugía',
  '10': 'Neurología',
  '5':  'Nutrición',
  '6':  'Nutriología',
  '12': 'Oncología',
  '56': 'Pediatria',
  '15': 'Procedimientos',
  '7':  'Psicología',
  '8':  'Psiquiatría',
};

/* ─────────────────────────  queries a probar  ───────────────────────── */
type QueryEntry = {
  label: string;
  /** 'professional' = busca en tab profesional, 'specialty' = busca en tab especialidad */
  mode: 'professional' | 'specialty';
  /** para mode=professional: ID directo del profesional (más robusto que fuzzy) */
  profId?: string;
  /** para mode=professional: texto de búsqueda fuzzy (fallback si profId no está en la lista) */
  query?: string;
  /** para mode=specialty: ID de la especialidad en ul.general-results */
  specId?: string;
};

const QUERIES: QueryEntry[] = [
  // ── por nombre de profesional (match directo por ID) ──
  { label: 'Magaly Cerquera (Nutrición)',              mode: 'professional', profId: '69',  query: 'cerquera' },
  { label: 'Peggy Huerta (Psicología)',                mode: 'professional', profId: '8',   query: 'huerta' },
  { label: 'Francisca Naritelli (Psicología)',         mode: 'professional', profId: '124', query: 'naritelli' },
  { label: 'Katherinne Araya (Nutriología)',           mode: 'professional', profId: '4',   query: 'katherinne araya' },
  { label: 'Ingrid Yevenes (Nutriología)',             mode: 'professional', profId: '44',  query: 'yevenes' },
  { label: 'Pablo Ramos (Medicina Deportiva)',         mode: 'professional', profId: '12',  query: 'pablo ramos' },
  { label: 'Carlos Nuñez (Medicina General)',          mode: 'professional', profId: '115', query: 'nuñez' },
  { label: 'Fernando Moya (Nutriología)',              mode: 'professional', profId: '140', query: 'moya' },
  { label: 'Nelson Aros (Cirugía Digestiva)',          mode: 'professional', profId: '58',  query: 'nelson aros' },
  { label: 'Rodrigo Villagran (Cirugía Digestiva)',    mode: 'professional', profId: '13',  query: 'villagran' },
  { label: 'Daniza Jaldín (Pediatría)',                mode: 'professional', profId: '142', query: 'jaldin' },
  { label: 'Katherine Saavedra (Nutrición)',           mode: 'professional', profId: '70',  query: 'saavedra' },
  { label: 'Rosirys Ruiz (Cirugía Plástica)',          mode: 'professional', profId: '149', query: 'rosirys' },
  { label: 'Sofia Araya (Nutriología)',                mode: 'professional', profId: '5',   query: 'sofia araya' },
  { label: 'Edmundo Ziede (Cirugía Plástica)',         mode: 'professional', profId: '148', query: 'ziede' },
  { label: 'Alberto Sirabo (Cirugía Digestiva)',       mode: 'professional', profId: '79',  query: 'sirabo' },
  { label: 'Rodrigo Bancalari (Endocrinología Inf.)',  mode: 'professional', profId: '46',  query: 'bancalari' },
  // ── por especialidad (click directo en ul.general-results li) ──
  { label: 'Especialidad: Nutrición',                  mode: 'specialty', specId: '5' },
  { label: 'Especialidad: Psicología',                 mode: 'specialty', specId: '7' },
  { label: 'Especialidad: Nutriología',                mode: 'specialty', specId: '6' },
  { label: 'Especialidad: Medicina Deportiva',         mode: 'specialty', specId: '4' },
  { label: 'Especialidad: Medicina General',           mode: 'specialty', specId: '53' },
  { label: 'Especialidad: Cirugía Digestiva',          mode: 'specialty', specId: '1' },
  { label: 'Especialidad: Pediatría',                  mode: 'specialty', specId: '56' },
  { label: 'Especialidad: Cirugía Plástica',           mode: 'specialty', specId: '54' },
  { label: 'Especialidad: Endocrinología Infantil',    mode: 'specialty', specId: '17' },
];

/* ── helpers ── */
function normalizeSpaces(value = ''): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
function normalizeText(value = ''): string {
  return normalizeSpaces(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function isoToDisplayDate(value = ''): string {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function pickRandomItem<T>(items: T[]): T | null {
  return items.length ? items[Math.floor(Math.random() * items.length)] ?? null : null;
}
function buildVariants(name = '', specialty = ''): string[] {
  const variants = new Set<string>();
  const nn = normalizeText(name);
  const ns = normalizeText(specialty);
  const tokens = nn.split(' ').filter(Boolean);
  if (nn) variants.add(nn);
  if (ns) variants.add(ns);
  for (const t of tokens) variants.add(t);
  if (tokens.length >= 2) { variants.add(tokens.slice(0, 2).join(' ')); variants.add(tokens.slice(-2).join(' ')); }
  if (tokens.length >= 3) variants.add(tokens.slice(0, 3).join(' '));
  return [...variants];
}
function candidatePriority(c: Candidate, q: string): number {
  const req = normalizeText(q);
  const nn = normalizeText(c.name);
  const ns = normalizeText(c.specialty);
  if (!req) return 0;
  if (nn === req) return 1;
  if (c.variants.includes(req)) return 2;
  if (nn.startsWith(req)) return 3;
  if (nn.includes(req)) return 4;
  if (ns === req) return 5;
  if (ns.startsWith(req)) return 6;
  if (ns.includes(req)) return 7;
  if (c.variants.some(v => v.startsWith(req))) return 8;
  if (c.variants.some(v => v.includes(req))) return 9;
  return 99;
}

/* ── page helpers ── */
async function loginAndSelectBranch(page: any, rut: string) {
  await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded' });

  const rutInput = page.locator('#agendar #step-0 input[name="run"]').first();
  await rutInput.fill(rut);
  await rutInput.dispatchEvent('input');
  await rutInput.dispatchEvent('change');

  const branchSelect = page.locator('#ubicacion');
  const branchOptions = await branchSelect.locator('option').evaluateAll((opts: HTMLOptionElement[]) =>
    opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() })).filter(o => o.value && o.label)
  );
  const branch = branchOptions.find((o: { value: string; label: string }) =>
    o.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes(
      DEFAULT_BRANCH_NAME.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    )
  );
  expect(branch, `Sucursal "${DEFAULT_BRANCH_NAME}" no encontrada`).toBeTruthy();
  await branchSelect.selectOption(branch!.value);
  await branchSelect.dispatchEvent('change');

  const nextBtn = page.locator('#agendar #step-0 #btn-step-one');
  await expect(nextBtn).toBeEnabled({ timeout: 10000 });
  await nextBtn.click();
}

async function waitForProfessionalResults(page: any) {
  const list = page.locator('ul.doctor-professional-results');
  await expect(list).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const loader = document.querySelector('#profesional-result-loader') as HTMLElement | null;
    const rows = document.querySelectorAll('ul.doctor-professional-results li.fila-profesional');
    return !(loader && getComputedStyle(loader).display !== 'none') && rows.length > 0;
  }, undefined, { timeout: 15000 });
}

async function waitForSpecialtyDoctorResults(page: any) {
  const list = page.locator('ul.doctor-results');
  await expect(list).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const loader = document.querySelector('#especialidades-result-loader') as HTMLElement | null;
    const rows = document.querySelectorAll('ul.doctor-results li.fila-profesional');
    return !(loader && getComputedStyle(loader).display !== 'none') && rows.length > 0;
  }, undefined, { timeout: 15000 });
}

async function waitForCalendar(page: any) {
  await expect(page.locator('#div_picker')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('#div_picker li.days-cell.cell')).some(cell => {
      const el = cell as HTMLElement;
      return /^\d+$/.test((el.textContent || '').trim()) && !/disabled|date-disabled|not-notable/i.test(el.className || '');
    });
  }, undefined, { timeout: 15000 });
}

async function readActiveCalendarTable(page: any): Promise<{ dataDia: string; times: string[] }> {
  const tables = await page.locator('.table-horarios').evaluateAll((tables: Element[]) => {
    return tables.map(t => {
      const el = t as HTMLElement;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const visible = s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      const times = Array.from(t.querySelectorAll('button.btn-reservar[data-hora]'))
        .map(b => (b as HTMLElement).getAttribute('data-hora') || '').filter(Boolean);
      return { visible, dataDia: el.getAttribute('data-dia') || '', times };
    }).filter(t => t.visible && t.dataDia && t.times.length).map(({ dataDia, times }) => ({ dataDia, times }));
  }).catch(() => []);
  return tables[0] || { dataDia: '', times: [] };
}

/** Lee profesionales del DOM (funciona tanto en tab profesional como tab especialidad) */
async function readProfessionalsFromList(page: any, listSelector: string) {
  return page.locator(listSelector).evaluate((list: HTMLElement) => {
    return Array.from(list.querySelectorAll('li.fila-profesional')).map(row => {
      const getText = (sel: string) => (row.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
      const btn = row.querySelector('button.btn-option');
      return {
        id: row.getAttribute('data-id-profesional') || '',
        name: btn?.getAttribute('profesional-name') || row.getAttribute('data-nombre-profesional') || getText('.doctor-title'),
        specialty: btn?.getAttribute('profesional-especialidad') || '',
        specialtyId: btn?.getAttribute('profesional-especialidad_id') || '',
        alert_text: getText('.doctor-alert'),
        text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
  });
}

/** Recolecta hasta MAX_SLOTS horarios del calendario de un profesional */
async function collectSlots(page: any, prof: { id: string; name: string; specialty: string; specialtyId: string; alert_text: string }): Promise<Slot[]> {
  const availableDayIndices: number[] = await page.locator('#div_picker li.days-cell.cell').evaluateAll((cells: HTMLElement[]) =>
    cells.map((c, i) => ({ i, cn: c.className || '', t: (c.textContent || '').trim() }))
      .filter(x => /^\d+$/.test(x.t) && !/disabled|date-disabled|not-notable/i.test(x.cn))
      .map(x => x.i)
  );

  const selectedDayIndex = await page.locator('#div_picker li.days-cell.cell.selected, #div_picker li.days-cell.cell.selected-date').evaluate((cell: Element) => {
    if (!cell) return -1;
    return Array.from(document.querySelectorAll('#div_picker li.days-cell.cell')).indexOf(cell);
  }).catch(() => -1);

  const prioritized = [
    ...availableDayIndices.filter(i => i !== selectedDayIndex),
    ...availableDayIndices.filter(i => i === selectedDayIndex),
  ];
  const slots: Slot[] = [];
  const seenDates = new Set<string>();

  for (const idx of prioritized) {
    if (slots.length >= MAX_SLOTS) break;
    const dayCell = page.locator('#div_picker li.days-cell.cell').nth(idx);
    await dayCell.scrollIntoViewIfNeeded().catch(() => {});
    const prevHidden = await page.locator('#dia_hidden').inputValue().catch(() => '');
    const prevLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent().catch(() => ''));
    const prevTable = await readActiveCalendarTable(page);

    await dayCell.click({ force: true });

    await page.waitForFunction(({ dayIndex, ph, pl, pd, pt }: any) => {
      const hi = (document.querySelector('#dia_hidden') as HTMLInputElement | null)?.value || '';
      const dl = ((document.querySelector('#dia-fecha') as HTMLElement | null)?.textContent || '').replace(/\s+/g, ' ').trim();
      const sel = document.querySelector('#div_picker li.days-cell.cell.selected, #div_picker li.days-cell.cell.selected-date');
      const si = Array.from(document.querySelectorAll('#div_picker li.days-cell.cell')).indexOf(sel as Element);
      const vt = Array.from(document.querySelectorAll('.table-horarios')).map(t => {
        const e = t as HTMLElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
        return (s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0) ? e : null;
      }).filter(Boolean) as HTMLElement[];
      const at = vt[0] || null;
      const ad = at?.getAttribute('data-dia') || '';
      const times = Array.from((at || document).querySelectorAll('button.btn-reservar[data-hora]'))
        .map(b => { const e = b as HTMLElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
          return (s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0) ? e.getAttribute('data-hora') || '' : '';
        }).filter(Boolean);
      return si === Number(dayIndex) && (hi !== ph || dl !== pl || ad !== pd || JSON.stringify(times) !== JSON.stringify(pt || []));
    }, { dayIndex: idx, ph: prevHidden, pl: prevLabel, pd: prevTable.dataDia, pt: prevTable.times }, { timeout: 10000 }).catch(() => {});

    await page.waitForTimeout(1000);

    const dateLabel = normalizeSpaces(await page.locator('#dia-fecha').textContent() || '');
    const hiddenDate = await page.locator('#dia_hidden').inputValue().catch(() => '');
    const activeTable = await readActiveCalendarTable(page);
    const activeDate = activeTable.dataDia || hiddenDate;
    if (!activeDate && !dateLabel) continue;

    const date = isoToDisplayDate(activeDate) || isoToDisplayDate(hiddenDate) || dateLabel;
    if (!date || seenDates.has(date)) continue;
    if (!activeTable.times.length) continue;

    const time = normalizeSpaces(pickRandomItem(activeTable.times) || '');
    if (!time) continue;

    seenDates.add(date);
    slots.push({
      date, time, dataDia: activeDate,
      booking_url: AGENDA_URL,
      professional: prof.name, professionalId: prof.id,
      specialty: prof.specialty, specialtyId: prof.specialtyId,
      alert_text: prof.alert_text,
      label: `${date} ${time}`,
    });
  }
  return slots;
}

/* ─────────────────────  test parametrizado  ───────────────────── */

for (const entry of QUERIES) {
  test(`agenda web → "${entry.label}"`, async ({ page }) => {
    test.setTimeout(120_000);

    const rut = process.env.MEDINET_RUT;
    test.skip(!rut, 'Define MEDINET_RUT para ejecutar.');

    /* ── paso 1: login con RUT + sucursal ── */
    await loginAndSelectBranch(page, rut!);

    let matchedProf: { id: string; name: string; specialty: string; specialtyId: string; alert_text: string };

    if (entry.mode === 'specialty') {
      /* ══════════════ BÚSQUEDA POR ESPECIALIDAD (tab especialidad) ══════════════ */
      await page.locator('a[href="#especialidad-tab"]').click();
      await expect(page.locator('ul.general-results')).toBeVisible({ timeout: 10000 });

      // Click directo en la especialidad por su data-nombre (ID)
      const specItem = page.locator(`ul.general-results li[data-nombre="${entry.specId}"]`);
      const specExists = await specItem.count();
      if (!specExists) {
        const available = await page.locator('ul.general-results li').evaluateAll((items: HTMLElement[]) =>
          items.map(li => `${li.getAttribute('data-nombre')}: ${li.getAttribute('data-especialidad')}`)
        );
        console.log(`Especialidades disponibles: ${available.join(', ')}`);
        test.skip(true, `Especialidad ID=${entry.specId} no encontrada en la lista`);
        return;
      }

      await specItem.click();

      // Esperar que carguen los profesionales de esa especialidad
      await waitForSpecialtyDoctorResults(page);

      // Leer profesionales listados para esa especialidad
      const specProfessionals = await readProfessionalsFromList(page, 'ul.doctor-results');
      console.log(`✓ Especialidad "${entry.label}" → ${specProfessionals.length} profesional(es):`);
      specProfessionals.forEach((p: any) => console.log(`   • [${p.id}] ${p.name}`));

      expect(specProfessionals.length, 'No hay profesionales para esta especialidad').toBeGreaterThan(0);

      // Tomar el primer profesional de la lista
      const first = specProfessionals[0];
      matchedProf = {
        id: first.id,
        name: first.name,
        specialty: first.specialty,
        specialtyId: first.specialtyId || entry.specId || '',
        alert_text: first.alert_text,
      };

      // Click en "Ver Agenda" del primer profesional
      const firstRow = page.locator(`ul.doctor-results li.fila-profesional[data-id-profesional="${first.id}"]`).first();
      await firstRow.locator('button.other-options.btn').click();

    } else {
      /* ══════════════ BÚSQUEDA POR PROFESIONAL (tab profesional) ══════════════ */
      await page.locator('a[href="#profesional-tab"]').click();
      await waitForProfessionalResults(page);

      const professionals = await readProfessionalsFromList(page, 'ul.doctor-professional-results');
      const candidates: Candidate[] = professionals.map((p: any) => ({ ...p, variants: buildVariants(p.name, p.specialty) }));

      // Intento 1: match directo por data-id-profesional (más robusto)
      let best = entry.profId ? candidates.find(c => c.id === entry.profId) : undefined;

      // Intento 2: fallback a fuzzy match por query
      if (!best && entry.query) {
        const sorted = [...candidates].sort((a, b) => candidatePriority(a, entry.query!) - candidatePriority(b, entry.query!));
        if (sorted[0] && candidatePriority(sorted[0], entry.query) < 99) {
          best = sorted[0];
        }
      }

      if (!best) {
        console.log(`Sin match para "${entry.label}" — profesionales disponibles:`);
        candidates.forEach(c => console.log(`   • [${c.id}] ${c.name} — ${c.specialty}`));
        test.skip(true, `No hay profesional que haga match con "${entry.label}"`);
        return;
      }

      const matchMethod = (entry.profId && best.id === entry.profId) ? 'ID directo' : 'fuzzy';
      console.log(`✓ "${entry.label}" → matched (${matchMethod}): [${best.id}] ${best.name} (${best.specialty})`);

      matchedProf = {
        id: best.id,
        name: best.name,
        specialty: best.specialty,
        specialtyId: best.specialtyId,
        alert_text: best.alert_text,
      };

      // Click en "Ver Agenda"
      const targetRow = page.locator(`li.fila-profesional[data-id-profesional="${best.id}"]`).first();
      await targetRow.locator('button.other-options.btn').click();
    }

    /* ── paso 3: calendario ── */
    await waitForCalendar(page);
    await page.waitForTimeout(800);

    /* ── paso 4: recoger horarios ── */
    const slots = await collectSlots(page, matchedProf);

    /* ── resultado ── */
    console.log(`  profesional: [${matchedProf.id}] ${matchedProf.name}`);
    console.log(`  especialidad: ${matchedProf.specialty} (ID: ${matchedProf.specialtyId})`);
    if (matchedProf.alert_text) console.log(`  alerta: ${matchedProf.alert_text}`);
    console.log(`  slots encontrados: ${slots.length}`);
    slots.forEach((s, i) => console.log(`    ${i + 1}. ${s.date} a las ${s.time}`));

    expect(matchedProf.name).toBeTruthy();
    expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
  });
}
