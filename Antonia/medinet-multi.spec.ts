/**
 * Test parametrizado: prueba múltiples profesionales/especialidades de la agenda web.
 *
 * Uso:
 *   MEDINET_RUT="13580388k" npx playwright test Antonia/medinet-multi.spec.ts
 *
 * Opcional:
 *   MEDINET_BRANCH_NAME="Antofagasta Mall Arauco Express"
 *   MEDINET_HEADED=true          # para ver el navegador
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

/* ── constantes ── */
const AGENDA_URL = 'https://clinyco.medinetapp.com/agendaweb/planned/';
const DEFAULT_BRANCH_NAME = process.env.MEDINET_BRANCH_NAME || 'Antofagasta Mall Arauco Express';
const MAX_SLOTS = 3;

/* ─────────────────────────  queries a probar  ───────────────────────── */
const QUERIES: { label: string; query: string }[] = [
  { label: 'nutricion',          query: 'nutricion' },
  { label: 'nelson',             query: 'nelson' },
  { label: 'kinesiologia',       query: 'kinesiologia' },
  { label: 'psicologia',         query: 'psicologia' },
  { label: 'dermatologia',       query: 'dermatologia' },
  { label: 'medicina general',   query: 'medicina general' },
  { label: 'ginecologia',        query: 'ginecologia' },
  { label: 'pediatria',          query: 'pediatria' },
  { label: 'traumatologia',      query: 'traumatologia' },
  { label: 'oftalmologia',       query: 'oftalmologia' },
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
async function waitForProfessionalResults(page: any) {
  const list = page.locator('ul.doctor-professional-results');
  await expect(list).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const loader = document.querySelector('#profesional-result-loader') as HTMLElement | null;
    const rows = document.querySelectorAll('ul.doctor-professional-results li.fila-profesional');
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

/* ─────────────────────  test parametrizado  ───────────────────── */

for (const { label, query } of QUERIES) {
  test(`agenda web → "${label}"`, async ({ page }) => {
    test.setTimeout(120_000);

    const rut = process.env.MEDINET_RUT;
    test.skip(!rut, 'Define MEDINET_RUT para ejecutar.');

    /* ── paso 1: RUT + sucursal ── */
    await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded' });

    const rutInput = page.locator('#agendar #step-0 input[name="run"]').first();
    await rutInput.fill(rut!);
    await rutInput.dispatchEvent('input');
    await rutInput.dispatchEvent('change');

    const branchSelect = page.locator('#ubicacion');
    const branchOptions = await branchSelect.locator('option').evaluateAll((opts: HTMLOptionElement[]) =>
      opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() })).filter(o => o.value && o.label)
    );
    const branch = branchOptions.find(o =>
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

    /* ── paso 2: lista de profesionales ── */
    await page.locator('a[href="#profesional-tab"]').click();
    await waitForProfessionalResults(page);

    const professionals = await page.locator('ul.doctor-professional-results').evaluate((list: HTMLElement) => {
      return Array.from(list.querySelectorAll('li.fila-profesional')).map(row => {
        const getText = (sel: string) => (row.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
        const btn = row.querySelector('button.btn-option');
        return {
          id: row.getAttribute('data-id-profesional') || '',
          name: btn?.getAttribute('profesional-name') || row.getAttribute('data-nombre-profesional') || getText('.doctor-title'),
          specialty: btn?.getAttribute('profesional-especialidad') || getText('.doctor-title strong'),
          alert_text: getText('.doctor-alert'),
          text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      });
    });

    const candidates: Candidate[] = professionals.map((p: any) => ({ ...p, variants: buildVariants(p.name, p.specialty) }));
    const best = [...candidates].sort((a, b) => candidatePriority(a, query) - candidatePriority(b, query))[0];

    if (!best || candidatePriority(best, query) >= 99) {
      console.log(`⚠ "${label}": sin match en la agenda — profesionales disponibles:`);
      candidates.forEach(c => console.log(`   • ${c.name} — ${c.specialty}`));
      test.skip(true, `No hay profesional/especialidad que haga match con "${label}"`);
      return;
    }

    console.log(`✓ "${label}" → matched: ${best.name} (${best.specialty})`);

    /* ── paso 3: abrir calendario del profesional ── */
    const targetRow = page.locator(`li.fila-profesional[data-id-profesional="${best.id}"]`).first();
    await targetRow.locator('button.other-options.btn').click();
    await waitForCalendar(page);
    await page.waitForTimeout(800);

    /* ── paso 4: recoger hasta MAX_SLOTS horarios ── */
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
        professional: best.name, professionalId: best.id,
        specialty: best.specialty, alert_text: best.alert_text,
        label: `${date} ${time}`,
      });
    }

    /* ── resultado ── */
    console.log(`  profesional: ${best.name}`);
    console.log(`  especialidad: ${best.specialty}`);
    console.log(`  slots encontrados: ${slots.length}`);
    slots.forEach((s, i) => console.log(`    ${i + 1}. ${s.date} a las ${s.time}`));

    expect(best.name).toBeTruthy();
    expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
  });
}
