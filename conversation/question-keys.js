export function buildQuestionKey({ caseType = "", nextAction = "", missingField = "", question = "" }) {
  return [caseType, nextAction, missingField, question].join("|");
}
