from pathlib import Path
p = Path('server.js')
s = p.read_text(encoding='utf-8')

old_decl = '''  let sentAsAudio = false;
  try {
'''
new_decl = '''  let sentAsAudio = false;
  let deliveredReply = finalReply;
  const sentBubbles = [];
  try {
'''
if s.count(old_decl) != 1:
    raise SystemExit(f'decl mismatch: {s.count(old_decl)}')
s = s.replace(old_decl, new_decl, 1)

old_loop = '''        await sendConversationReply(appId, conversationId, bubblesToSend[i], info);
      }
    }
'''
new_loop = '''        await sendConversationReply(appId, conversationId, bubblesToSend[i], info);
        sentBubbles.push(bubblesToSend[i]);
      }
      if (sentBubbles.length) {
        deliveredReply = sentBubbles.join("\\n\\n");
      }
    }
'''
if s.count(old_loop) != 1:
    raise SystemExit(f'loop mismatch: {s.count(old_loop)}')
s = s.replace(old_loop, new_loop, 1)

old_tail = '''  addToHistory(conversationId, "assistant", finalReply);

  latestState.system.botMessagesSent += 1;
  rememberOutboundReply(latestState, finalReply, kind);
  let shouldSaveSummary = false;

  if (disableAiAfterSend) {
    latestState.system.aiEnabled = false;
    latestState.system.handoffReason = handoffReasonAfterSend || latestState.system.handoffReason || null;
    shouldSaveSummary = true;
  } else if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
    markMaxMessagesReached(latestState);
    shouldSaveSummary = true;
  }

  await persistConversationMessage({
    conversationId,
    role: "assistant",
    channel: channelLabel,
    sourceType: "api:conversations",
    content: finalReply,
    rawJson: { kind, resolverDecision, sentAsAudio },
    authorDisplayName: "Antonia"
  });
  await saveConversationEvent({
    conversationId,
    info,
    channelLabel,
    userText,
    botReply: finalReply,
    state: latestState,
    resolverDecision
  });
  await persistConversationSnapshot(conversationId, latestState, channelLabel);
  if (shouldSaveSummary) {
    await maybeSaveConversationSummary(conversationId, latestState, channelLabel);
  }

  return {
    ok: true,
    reply: finalReply,
    delayMs,
    botMessagesSent: latestState.system.botMessagesSent,
    handoffReason: latestState.system.handoffReason || null,
    resolverDecision: resolverDecision || null,
    sentAsAudio
  };
'''
new_tail = '''  addToHistory(conversationId, "assistant", deliveredReply);

  latestState.system.botMessagesSent += 1;
  rememberOutboundReply(latestState, deliveredReply, kind);
  let shouldSaveSummary = false;

  if (disableAiAfterSend) {
    latestState.system.aiEnabled = false;
    latestState.system.handoffReason = handoffReasonAfterSend || latestState.system.handoffReason || null;
    shouldSaveSummary = true;
  } else if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
    markMaxMessagesReached(latestState);
    shouldSaveSummary = true;
  }

  await persistConversationMessage({
    conversationId,
    role: "assistant",
    channel: channelLabel,
    sourceType: "api:conversations",
    content: deliveredReply,
    rawJson: { kind, resolverDecision, sentAsAudio, bubbles: sentAsAudio ? null : sentBubbles },
    authorDisplayName: "Antonia"
  });
  await saveConversationEvent({
    conversationId,
    info,
    channelLabel,
    userText,
    botReply: deliveredReply,
    state: latestState,
    resolverDecision
  });
  await persistConversationSnapshot(conversationId, latestState, channelLabel);
  if (shouldSaveSummary) {
    await maybeSaveConversationSummary(conversationId, latestState, channelLabel);
  }

  return {
    ok: true,
    reply: deliveredReply,
    delayMs,
    botMessagesSent: latestState.system.botMessagesSent,
    handoffReason: latestState.system.handoffReason || null,
    resolverDecision: resolverDecision || null,
    sentAsAudio,
    bubbles: sentAsAudio ? [deliveredReply] : sentBubbles
  };
'''
if s.count(old_tail) != 1:
    raise SystemExit(f'tail mismatch: {s.count(old_tail)}')
s = s.replace(old_tail, new_tail, 1)

p.write_text(s, encoding='utf-8')
