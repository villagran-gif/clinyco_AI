import { getBasePromptBundle } from "../prompts/stage-prompts.js";
import { buildStateSummary } from "../memory/state-summary.js";

export function composeOpenAIMessages({ stage, history = [], state, strategy, curatedExamples = [], userText = "" }) {
  const promptParts = [
    getBasePromptBundle(stage),
    `[OBJETIVO_ACTUAL] ${strategy?.objective || "orientar"}`,
    `[ESTRATEGIA] ${strategy?.strategy || "inform_then_optional_question"}`,
    buildStateSummary(state)
  ];

  if (strategy?.missingField) {
    promptParts.push(`[SIGUIENTE_DATO_UTIL] ${strategy.missingField}`);
  }

  if (curatedExamples.length) {
    promptParts.push("[EJEMPLOS_CURADOS]");
    for (const example of curatedExamples) {
      promptParts.push(JSON.stringify(example));
    }
  }

  const messages = [
    { role: "system", content: promptParts.join("\n\n") },
    ...history,
    { role: "user", content: userText }
  ];

  return messages;
}
