import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../Antonia/medinet-api.js', import.meta.url), 'utf8');
const formSource = source.slice(source.indexOf('export async function bookAgendaweb'), source.indexOf('// ─── Business error helpers')).replace('export ', '');
const wrapperSource = source.slice(source.indexOf('export async function bookAppointmentForPatient'), source.indexOf('// ─── API-first search')).replace('export ', '');
const base = { pacienteExiste: false, run: 'TEST', fecha: '2030-01-03', hora: '15:00', profesional: 13,
  especialidad: 1, tipo: 276, duracion: 20, ubicacion: 41, nombre: 'Prueba', apellidos: 'Integracion',
  direccion: 'Direccion de prueba', sexo: 'masculino', fechaNacimiento: '1990-05-15', aseguradora: 4,
  telefono: '+56900000000', email: 'test@example.com' };
function formHarness(response = { status: 'agendado_correctamente' }, status = 200) {
  const calls = [];
  const context = vm.createContext({ BASE_URL: 'https://clinyco.medinetapp.com', URLSearchParams, AbortSignal,
    fetch: async (...args) => { calls.push(args); return { ok: status === 200, status, text: async () => JSON.stringify(response) }; } });
  vm.runInContext(formSource, context);
  return { calls, book: context.bookAgendaweb };
}
test('new patient sends complete demographics without auth and preserves phone plus', async () => {
  const h = formHarness(); await h.book(base);
  assert.equal(h.calls.length, 1);
  const [, req] = h.calls[0]; const form = new URLSearchParams(req.body);
  for (const key of ['nombre','apellidos','direccion','sexo','fecha_nacimiento','aseguradora']) assert.ok(form.get(key));
  assert.equal(form.get('telefono_fijo'), base.telefono);
  assert.equal(req.headers.Authorization, undefined);
  assert.equal(req.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(req.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(req.redirect, 'manual');
});
test('existing patient never sends replacement demographics', async () => {
  const h = formHarness(); await h.book({ ...base, pacienteExiste: true });
  const form = new URLSearchParams(h.calls[0][1].body);
  for (const key of ['nombre','apellidos','direccion','sexo','fecha_nacimiento','aseguradora']) assert.equal(form.get(key), '');
  assert.equal(form.get('run'), base.run);
});
test('unknown existence and incomplete registration prevent POST', async () => {
  const h = formHarness();
  await assert.rejects(h.book({ ...base, pacienteExiste: undefined }));
  await assert.rejects(h.book({ ...base, email: '' }), /email/);
  assert.equal(h.calls.length, 0);
});
test('403 is returned once without token fallback or retry', async () => {
  const h = formHarness({ detail: 'Forbidden' }, 403);
  await assert.rejects(h.book(base)); assert.equal(h.calls.length, 1);
});
const slot = { professionalId: 13, specialtyId: 1, tipoCitaId: 276, professional: 'Test', dataDia: '2030-01-03', time: '15:00', duration: 20 };
async function wrapper({ exists = false, live = [slot], result = { status: 'agendado_correctamente' }, throws = false, verified = false } = {}) {
  const calls = [];
  let reads = 0;
  const context = vm.createContext({ normalizeText: s => s,
    fetchAllAppointments: async () => (++reads > 1 && verified) ? [{ id: 123, paciente: {run: "TEST"}, fecha: slot.dataDia, hora: slot.time, sucursal: {id: 41}, tipo_id: 276, profesional: {nombres: "Test"} }] : [],
    DEFAULT_BRANCH_ID: 39, formatRutWithDots: s => s,
    checkCupos: async () => ({ paciente_existe: exists }), searchSlotsViaApi: async () => ({ available_slots: live }),
    isAgendawebBusinessFailure: r => r?.status === 'cupo_tomado',
    bookAgendaweb: async data => { calls.push(data); if (throws) throw Error('timeout'); return result; } });
  vm.runInContext(wrapperSource, context);
  const response = await context.bookAppointmentForPatient({ slot, branchId: 41,
    patientData: { rut: 'TEST', nombres: 'Test', apPaterno: 'Patient', nacimiento: '1990-05-15', aseguradoraId: 4 } });
  return { calls, response };
}
test('wrapper uses fresh existence and forwards new patient fields', async () => {
  const { calls } = await wrapper(); assert.equal(calls[0].pacienteExiste, false);
  assert.equal(calls[0].nombre, 'Test'); assert.equal(calls[0].apellidos, 'Patient');
  assert.equal(calls[0].fechaNacimiento, '1990-05-15'); assert.equal(calls[0].aseguradora, 4);
});
test('no identifier cannot confirm and cannot cause a second write', async () => {
  const { response, calls } = await wrapper();
  assert.equal(response.success, false); assert.equal(response.requiresVerification, true); assert.equal(calls.length, 1);
});
test('timeout cannot trigger another write endpoint', async () => {
  const { response, calls } = await wrapper({ throws: true });
  assert.equal(response.requiresVerification, true); assert.equal(calls.length, 1);
});
test('changed slot and unknown existence prevent booking', async () => {
  assert.equal((await wrapper({ live: [] })).calls.length, 0);
  assert.equal((await wrapper({ exists: null })).calls.length, 0);
});
test('business rejection stays unsuccessful', async () => {
  const { response, calls } = await wrapper({ result: { status: 'cupo_tomado' } });
  assert.equal(response.success, false); assert.equal(calls.length, 1);
});
test('identified accepted reservation succeeds', async () => {
  const { response } = await wrapper({ verified: true, result: { status: 'agendado_correctamente' } });
  assert.equal(response.success, true); assert.equal(response.appointmentId, 123);
});
test('new patient rejects malformed email and impossible birth date before POST', async () => {
  const h = formHarness();
  await assert.rejects(h.book({ ...base, email: 'test2example.com' }), /email/);
  await assert.rejects(h.book({ ...base, fechaNacimiento: '2020-02-31' }), /fechaNacimiento/);
  assert.equal(h.calls.length, 0);
});
test('Chile date and sex labels are encoded as verified Medinet values', async () => {
  const h = formHarness(); await h.book({ ...base, fechaNacimiento: '15/05/1990', sexo: 'Indeterminado' });
  const form = new URLSearchParams(h.calls[0][1].body);
  assert.equal(form.get('fecha_nacimiento'), '1990-05-15');
  assert.equal(form.get('sexo'), '3');
});
