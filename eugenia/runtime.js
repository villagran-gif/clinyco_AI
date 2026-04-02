import {
  getLatestPendingPredictions,
  insertEugeniaDirective,
  insertEugeniaTicketEvent,
  insertPrediction,
  markEugeniaTicketNotePublished,
  reserveEugeniaTicketNote,
  updateComparison,
  updateObservation
} from "../db.js";
import { parseStructuredAgentDirectives } from "./directives.js";
import { buildEugeniaInternalNote } from "./note-builder.js";
import { compareSuggestedActionToHumanText } from "./prediction.js";
import { extractCommentEventsFromAudits, isEugeniaInternalNote, publishPrivateTicketNote } from "./zendesk-ticket.js";

async function maybePublishInternalNote({
  conversationId,
  ticketId,
  turnNumber,
  state,
  resolverDecision,
  previousScore,
  zendeskSupportPut,
  logger = console
}) {
  if (!ticketId) return false;
  const { body, fingerprint } = buildEugeniaInternalNote({ state, resolverDecision, previousScore });
  const reservation = await reserveEugeniaTicketNote({
    conversationId,
    ticketId,
    turnNumber,
    noteFingerprint: fingerprint,
    noteBody: body
  });
  if (!reservation) {
    logger.log(`EUGENIA_NOTE_SKIPPED ticketId=${ticketId} reason=duplicate`);
    return false;
  }
  await publishPrivateTicketNote({ zendeskSupportPut, ticketId, body });
  await markEugeniaTicketNotePublished(reservation.id);
  logger.log(`EUGENIA_NOTE ticketId=${ticketId} noteId=${reservation.id}`);
  return true;
}

async function upsertDualPrediction({
  conversationId,
  turnNumber,
  state,
  resolverDecision
}) {
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
        zendeskRequesterId: state?.identity?.zendeskRequesterId || null,
        zendeskTicketId: state?.identity?.zendeskTicketId || null,
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

export async function onTakeover({
  conversationId,
  ticketId,
  state,
  resolverDecision,
  zendeskSupportPut,
  logger = console
}) {
  await upsertDualPrediction({
    conversationId,
    turnNumber: 1,
    state,
    resolverDecision
  });
  await maybePublishInternalNote({
    conversationId,
    ticketId,
    turnNumber: 1,
    state,
    resolverDecision,
    previousScore: null,
    zendeskSupportPut,
    logger
  });
  logger.log(`EUGENIA_PREDICT conversationId=${conversationId} turn=1`);
}

export async function onHumanAgentMessage({
  conversationId,
  ticketId,
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
      ticketId,
      sourceKind: "ticket_comment",
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

  const nextTurn = pendingList.reduce((maxTurn, pred) => Math.max(maxTurn, pred.turn_number || 0), 0) + 1;
  await upsertDualPrediction({
    conversationId,
    turnNumber: nextTurn,
    state,
    resolverDecision
  });
  logger.log(`EUGENIA_OBSERVE conversationId=${conversationId} observed=${pendingList.length} nextTurn=${nextTurn}`);
}

export async function onMutedPatientMessage({
  conversationId,
  ticketId,
  state,
  resolverDecision,
  zendeskSupportPut,
  logger = console
}) {
  const pendingList = await getLatestPendingPredictions(conversationId);
  const turnNumber = pendingList.reduce((maxTurn, pred) => Math.max(maxTurn, pred.turn_number || 0), 0) + 1;
  const previousScore = state?.leadScore?.score || 0;

  await upsertDualPrediction({
    conversationId,
    turnNumber,
    state,
    resolverDecision
  });

  if (ticketId && turnNumber % 2 === 0) {
    await maybePublishInternalNote({
      conversationId,
      ticketId,
      turnNumber,
      state,
      resolverDecision,
      previousScore,
      zendeskSupportPut,
      logger
    });
  }

  logger.log(`EUGENIA_PREDICT_ON_PATIENT_MSG conversationId=${conversationId} turn=${turnNumber}`);
}

export async function onTicketAuditsObserved({
  conversationId,
  ticketId,
  audits,
  logger = console
}) {
  const events = extractCommentEventsFromAudits(audits);
  let insertedCount = 0;

  for (const event of events) {
    if (!event.auditId || isEugeniaInternalNote(event.body)) continue;

    const inserted = await insertEugeniaTicketEvent({
      conversationId,
      ticketId,
      auditId: event.auditId,
      eventType: event.eventType || "Comment",
      authorId: event.authorId,
      sourcePublic: event.sourcePublic,
      body: event.body
    });
    if (!inserted) continue;
    insertedCount += 1;

    for (const directive of parseStructuredAgentDirectives(event.body || "")) {
      await insertEugeniaDirective({
        conversationId,
        ticketId,
        sourceKind: "ticket_audit",
        sourcePublic: event.sourcePublic,
        directiveType: directive.type,
        parsedField: directive.field || null,
        parsedValue: directive.value || null,
        rawText: directive.rawText || ""
      });
      logger.log(
        `EUGENIA_TICKET_DIRECTIVE type=${directive.type}` +
        `${directive.field ? ` field=${directive.field}` : ""}` +
        `${directive.value ? ` value=${directive.value}` : ""}` +
        ` conversationId=${conversationId} auditId=${event.auditId}`
      );
    }
  }

  logger.log(`EUGENIA_TICKET_AUDITS conversationId=${conversationId} ticketId=${ticketId} inserted=${insertedCount}`);
  return insertedCount;
}
