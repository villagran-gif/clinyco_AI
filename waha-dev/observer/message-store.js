import * as db from "./db.js";
import { analyzeMessage } from "../../analysis/sentiment.js";

/**
 * Process and store a WAHA message.
 * Returns the stored message record, or null if deduped.
 */
export async function save(conversation, wahaPayload, direction) {
  const body = wahaPayload.body || wahaPayload.text || "";
  const sentAt = wahaPayload.timestamp
    ? new Date(wahaPayload.timestamp * 1000)
    : new Date();

  const hasMedia = !!(wahaPayload.hasMedia || wahaPayload.mediaUrl);
  const mediaType = wahaPayload.mediaType || null;
  const pushName = wahaPayload.pushName || wahaPayload._data?.notifyName || null;
  const wahaMessageId = wahaPayload.id || wahaPayload._data?.id?._serialized || null;

  // Run per-message analysis (emoji, sentiment, signals)
  const useLLM = process.env.SENTIMENT_LLM_ENABLED === "true";
  const analysis = await analyzeMessage(body, db.getEmojiSentimentBatch, { useLLM });

  const message = await db.insertMessage({
    conversationId: conversation.id,
    wahaMessageId,
    direction,
    body,
    hasMedia,
    mediaType,
    pushName,
    rawJson: wahaPayload,
    bodyClean: analysis.bodyClean,
    bodyTextOnly: analysis.bodyTextOnly,
    emojiList: analysis.emojiList,
    emojiCount: analysis.emojiCount,
    emojiSentimentAvg: analysis.emojiSentimentAvg,
    emojiSentimentMin: analysis.emojiSentimentMin,
    emojiSentimentMax: analysis.emojiSentimentMax,
    textSentimentScore: analysis.textSentimentScore,
    wordCount: analysis.wordCount,
    hasQuestion: analysis.hasQuestion,
    hasUrl: analysis.hasUrl,
    detectedSignals: analysis.detectedSignals,
    hourOfDay: sentAt.getHours(),
    dayOfWeek: sentAt.getDay(),
    sentAt,
    sentimentModel: analysis.sentimentModel,
    sentimentConfidence: analysis.sentimentConfidence,
    sentimentRationale: analysis.sentimentRationale,
    analysisVersion: analysis.analysisVersion,
  });

  if (!message) {
    console.log(`[message-store] Deduped message ${wahaMessageId}`);
    return null;
  }

  // Update conversation stats
  await db.updateConversationStats(conversation.id, sentAt);

  console.log(
    `[message-store] Saved msg #${message.id} ${direction} conv=#${conversation.id} ` +
    `emojis=${analysis.emojiCount} signals=[${analysis.detectedSignals.join(",")}]`
  );

  return message;
}
