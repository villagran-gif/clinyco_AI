export function shouldAskIdentityNow({ stage, strategy }) {
  return Boolean(strategy?.askIdentityNow || stage === "paciente_existente");
}

export function shouldShortCircuitWithDeterministicQuestion({ resolverDecision }) {
  return Boolean(resolverDecision?.question);
}
