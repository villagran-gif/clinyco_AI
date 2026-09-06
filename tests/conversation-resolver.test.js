import test from "node:test";
import assert from "node:assert/strict";

import {
  applyResolverToState,
  getNextBestQuestion,
} from "../conversation-resolver.js";

function baseState() {
  return {
    contactDraft: {},
    dealDraft: {},
    measurements: {},
    identity: {},
    booking: {},
    system: {},
  };
}

test("mantiene objetivo de agenda aunque el turno siguiente no diga agenda", () => {
  const state = baseState();

  const first = getNextBestQuestion(state, null, null, "Agenda disponible?");
  assert.equal(first.resolved.stage, "schedule_request");
  applyResolverToState(state, first);
  assert.equal(state.identity.conversationGoal, "schedule");

  const second = getNextBestQuestion(state, null, null, "Soy de Santiago");
  assert.equal(second.resolved.stage, "schedule_request");
  applyResolverToState(state, second);
  assert.equal(state.identity.conversationGoal, "schedule");
});

test("respuestas operativas continúan dentro del objetivo de agenda", () => {
  const state = baseState();
  const first = getNextBestQuestion(state, null, null, "Quiero agendar una hora");
  applyResolverToState(state, first);

  for (const reply of ["Presencial", "El jueves", "Fonasa", "Con el Dr. Villagrán"]) {
    const decision = getNextBestQuestion(state, null, null, reply);
    assert.equal(decision.resolved.stage, "schedule_request", reply);
    applyResolverToState(state, decision);
  }
});

test("sale del objetivo de agenda cuando el paciente cambia explícitamente de intención", () => {
  const state = baseState();
  const first = getNextBestQuestion(state, null, null, "Quiero agendar");
  applyResolverToState(state, first);
  assert.equal(state.identity.conversationGoal, "schedule");

  const changed = getNextBestQuestion(state, null, null, "Solo quiero información sobre manga");
  assert.notEqual(changed.resolved.stage, "schedule_request");
  applyResolverToState(state, changed);
  assert.equal(state.identity.conversationGoal, null);
});
