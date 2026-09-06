import {
  getLatestPendingPredictions,
  insertEugeniaDirective,
  insertPrediction,
  updateComparison,
  updateObservation
} from "../db.js";
import { parseStructuredAgentDirectives } from "./directives.js";
import { compareSuggestedActionToHumanText } from "./prediction.js";

async function upsertDualPrediction({ conversationId, turnNumber, state, resolverDecision }) {
  const commonPred = {
    conversationId,
    turnNumber,
    leadScoreAtPrediction: state?.leadScore?.score || 0,
    pipeline: state?.leadScore?.pipeline || null,
    stateSnapshot: {
      leadScore: state?.leadScore || null,
      contactDraft: state?.contactDraft || null,
      dealDraft: state?.dealDraft || null,
      identity: {
        caseType: state?.identity?.caseType || null
      }
    }
  };

  const questionPrediction = await insertPrediction({
    ...commonPred,
    predictionType: "question",
    aiSuggestedAction: resolverDecision?.question || "Sin pregunta"
  });
  const actionPrediction = await insertPrediction({
    ...commonPred,
    predictionType: "action",
    aiSuggestedAction: resolverDecision?.actionLabel || "Continuar recopilando datos"
  });
  return { questionPrediction, actionPrediction };
}

// Channel-agnostic takeover hook. Predictions remain in PostgreSQL; no ticket notes
// or external Zendesk writes are performed.
export async function onTakeover({ conversationId, state, resolverDecision, logger = console }) {
  await upsertDualPrediction({
    conversationId,
    turnNumber: 1,
    state,
    resolverDecision
  });
  logger.log(`EUGENIA_PREDICT conversationId=${conversationId} turn=1`);
}

// Observe a real human-agent message coming from Chatwoot. The learning loop is
// stored locally in PostgreSQL and does not depend on Zendesk ticket audits.
export async function onHumanAgentMessage({
  conversationId,
  text,
  sourcePublic = null,
  state,
  resolverDecision,
  logger = console
}) {
  const directives = parseStructuredAgentDirectives(text);
  for (const directive of directives) {
    await insertEugeniaDirective({
      conversationId,
      ticketId: null,
      sourceKind: "chatwoot_agent_message",
      sourcePublic,
      directiveType: directive.type,
      parsedField: directive.field || null,
      parsedValue: directive.value || null,
      rawText: directive.rawText || ""
    });
    logger.log(
      `EUGENIA_AGENT_DIRECTIVE type=${directive.type}` +
      `${directive.field ? ` field=${directive.field}` : ""}` +
      `${directive.value ? ` value=${directive.value}` : ""}` +
      ` conversationId=${conversationId}`
    );
  }

  const pendingList = await getLatestPendingPredictions(conversationId);
  for (const pending of pendingList) {
    await updateObservation(pending.id, { humanActualAction: text || "" });
    const { matchType, matchScore } = compareSuggestedActionToHumanText(
      pending.ai_suggested_action,
      text || ""
    );
    await updateComparison(pending.id, { matchType, matchScore });
  }

  const nextTurn = pendingList.reduce(
    (maxTurn, pred) => Math.max(maxTurn, pred.turn_number || 0),
    0
  ) + 1;
  await upsertDualPrediction({
    conversationId,
    turnNumber: nextTurn,
    state,
    resolverDecision
  });
  logger.log(
    `EUGENIA_OBSERVE conversationId=${conversationId} observed=${pendingList.length} nextTurn=${nextTurn}`
  );
}

// While AntonIA is paused, keep generating local predictions so EugenIA can learn
// from the human handoff. No external support-system writes are performed.
export async function onMutedPatientMessage({
  conversationId,
  state,
  resolverDecision,
  logger = console
}) {
  const pendingList = await getLatestPendingPredictions(conversationId);
  const turnNumber = pendingList.reduce(
    (maxTurn, pred) => Math.max(maxTurn, pred.turn_number || 0),
    0
  ) + 1;

  await upsertDualPrediction({
    conversationId,
    turnNumber,
    state,
    resolverDecision
  });

  logger.log(
    `EUGENIA_PREDICT_ON_PATIENT_MSG conversationId=${conversationId} turn=${turnNumber}`
  );
}
