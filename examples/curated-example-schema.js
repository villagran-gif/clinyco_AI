export function buildCuratedExample({
  exampleId,
  channel,
  intent,
  stage,
  outcome,
  qualityScore,
  messages
}) {
  return {
    exampleId,
    channel,
    intent,
    stage,
    outcome,
    qualityScore,
    messages: Array.isArray(messages) ? messages : []
  };
}
