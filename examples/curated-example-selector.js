export function selectCuratedExamples({ examples = [], channel = null, stage = null, intent = null, limit = 3 }) {
  return examples
    .filter((example) => (!channel || example.channel === channel || example.channel === "any"))
    .filter((example) => (!stage || example.stage === stage))
    .filter((example) => (!intent || example.intent === intent || example.intent === "generic"))
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    .slice(0, limit);
}
