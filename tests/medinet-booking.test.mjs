import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(new URL("../workers/medinet-worker.js", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("async function handleMelaniaBooking"),
  source.indexOf("/**\n * MelanIA: Search slots only"));
const slot = { professionalId: "13", specialtyId: 1, tipoCitaId: 276,
  dataDia: "2026-09-11", time: "15:00", duration: 20, professional: "Test" };

async function run({ cupos = { paciente_existe: true, puede_agendar: true },
  chosen = slot, live = [slot], response = { status: 200, data: { status: true, id: 123 } },
  checkError = false } = {}) {
  const posts = [];
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, DEFAULT_BRANCH_ID: 39,
    formatRutWithDots: s => s,
    resolvePrevisionIds: () => ({ aseguradoraId: 4 }),
    bookAppointmentForPatient: async () => ({ success: false, step: "patient_data" }),
    checkCupos: async () => { if (checkError) throw Error("403"); return cupos; },
    searchSlotsViaApi: async () => ({ available_slots: live }),
    searchSlotsNoAuth: async () => ({ available_slots: live }),
    melaniaBookWithSession: async body => { posts.push(body); return response; },
  });
  vm.runInContext(handler, context);
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await context.handleMelaniaBooking({ body: { query: "Test", slot: chosen, branchId: 41,
    patientData: { rut: "TEST-RUN", nombres: "Never overwrite", fono: "Never overwrite" } } }, res);
  return { posts, res };
}

test("flat authenticated booking preserves selected slot and omits patient edits", async () => {
  const { posts, res } = await run();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].profesional, "13");
  assert.equal(posts[0].ubicacion, 41);
  assert.equal(posts[0].fecha, slot.dataDia);
  assert.equal(posts[0].hora, slot.time);
  assert.equal(posts[0].run, "TEST-RUN");
  for (const k of ["slot", "patientData", "nombre", "apellidos", "telefono_movil", "comuna"])
    assert.equal(k in posts[0], false);
  assert.equal(res.body.success, true);
  assert.equal(res.body.appointmentId, 123);
});

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const orchestrator = server.slice(server.indexOf("async function runMedinetAntoniaBooking"),
  server.indexOf("function detectBookingSlotChoice"));
for (const mode of ["failure", "timeout", "empty"]) {
  test("Render never falls through after remote " + mode, async () => {
    let calls = 0;
    const context = vm.createContext({
      process: { env: {} }, console: { log() {}, warn() {} },
      useRemoteWorker: () => true,
      callMedinetWorkerPath: async () => {
        calls++;
        if (mode === "timeout") throw Error("timeout");
        return mode === "empty" ? null : { success: false, step: "book" };
      },
      apiBookAppointment: () => { throw Error("Unexpected second booking"); },
    });
    vm.runInContext(orchestrator, context);
    const result = await context.runMedinetAntoniaBooking({ slot, patientData: { rut: "TEST" } });
    assert.equal(calls, 1);
    assert.equal(result.success, false);
  });
}

test("permission check failure prevents any booking", async () => {
  const { posts, res } = await run({ checkError: true });
  assert.equal(posts.length, 0);
  assert.equal(res.body.step, "check_cupos");
});
test("patient restriction prevents booking", async () => {
  const { posts, res } = await run({ cupos: { paciente_existe: true, puede_agendar: false } });
  assert.equal(posts.length, 0);
  assert.equal(res.body.success, false);
});
test("missing selection never books first slot", async () => {
  const { posts, res } = await run({ chosen: null });
  assert.equal(posts.length, 0);
  assert.equal(res.body.step, "selected_slot");
});
test("changed availability never substitutes another time", async () => {
  const { posts, res } = await run({ live: [{ ...slot, time: "16:00" }] });
  assert.equal(posts.length, 0);
  assert.equal(res.body.step, "slot_revalidate");
});
test("success without reservation identifier remains unconfirmed", async () => {
  const { posts, res } = await run({ response: { status: 200, data: { status: true } } });
  assert.equal(posts.length, 1);
  assert.equal(res.body.success, false);
});
test("Medinet rejection makes one attempt without overschedule fallback", async () => {
  const { posts, res } = await run({ response: { status: 403, data: { detail: "Denied" } } });
  assert.equal(posts.length, 1);
  assert.equal(res.body.success, false);
});
test("unregistered patient is not sent to admin endpoint", async () => {
  const { posts, res } = await run({ cupos: { paciente_existe: false } });
  assert.equal(posts.length, 0);
  assert.equal(res.body.step, "patient_data");
});
