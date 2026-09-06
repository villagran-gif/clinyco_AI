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

# Todas las mutaciones posteriores deben usar lo realmente enviado.
replacements = {
    '  addToHistory(conversationId, "assistant", finalReply);': '  addToHistory(conversationId, "assistant", deliveredReply);',
    '  rememberOutboundReply(latestState, finalReply, kind);': '  rememberOutboundReply(latestState, deliveredReply, kind);',
    '    content: finalReply,': '    content: deliveredReply,',
    '    botReply: finalReply,': '    botReply: deliveredReply,',
    '    reply: finalReply,': '    reply: deliveredReply,',
}
for old, new in replacements.items():
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'replacement mismatch {old}: {count}')
    s = s.replace(old, new, 1)

# Exponer para observabilidad qué burbujas salieron realmente.
old_return_tail = '''    resolverDecision: resolverDecision || null,
    sentAsAudio
  };
'''
new_return_tail = '''    resolverDecision: resolverDecision || null,
    sentAsAudio,
    bubbles: sentAsAudio ? [deliveredReply] : sentBubbles
  };
'''
if s.count(old_return_tail) != 1:
    raise SystemExit(f'return tail mismatch: {s.count(old_return_tail)}')
s = s.replace(old_return_tail, new_return_tail, 1)

p.write_text(s, encoding='utf-8')
