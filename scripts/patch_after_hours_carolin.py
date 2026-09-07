from pathlib import Path

p = Path('server.js')
s = p.read_text()

# Import policy helpers.
anchor = 'import { isChatwootPayload, parseChatwootInbound } from "./chatwoot-adapter/parse.js";\n'
addition = '''import {\n  registerAfterHoursInbound,\n  parseCallbackPreference,\n  shouldCloseAfterHours,\n  markAfterHoursClosed,\n  setCallbackPreference,\n  buildAfterHoursClosureReply,\n  buildAfterHoursPreferenceReply,\n} from "./after-hours.js";\n'''
assert anchor in s
s = s.replace(anchor, addition + anchor, 1)

# Register after-hours inbound after extracting drafts, then intercept closed night conversations.
anchor = '''    updateDraftsFromText(state, userText, info);\n    state.leadScore = calculateLeadScore(state);'''
replacement = '''    updateDraftsFromText(state, userText, info);\n\n    const afterHoursContext = registerAfterHoursInbound(state);\n    if (afterHoursContext.active && afterHoursContext.state.closed) {\n      const callbackPreference = parseCallbackPreference(userText);\n      if (callbackPreference) {\n        setCallbackPreference(state, callbackPreference);\n        await persistConversationSnapshot(conversationId, state, channelLabel);\n        return res.json(await sendManagedReply({\n          appId, conversationId, messageId, userText,\n          reply: buildAfterHoursPreferenceReply(callbackPreference),\n          kind: "after_hours_callback_preference",\n          state, info, channelLabel,\n          resolverDecision: { stage: "after_hours", nextAction: "callback_preference_saved", reason: "Night callback preference saved" }\n        }));\n      }\n\n      const simpleCloseAck = /^(gracias|ok|okay|perfecto|dale|ya|bueno|chao|chau|buenas noches)$/i.test(String(userText || "").trim());\n      if (simpleCloseAck) {\n        return res.json(await sendManagedReply({\n          appId, conversationId, messageId, userText,\n          reply: "perfecto[[MSG]]buenas noches",\n          kind: "after_hours_closed_ack",\n          state, info, channelLabel,\n          resolverDecision: { stage: "after_hours", nextAction: "closed_ack", reason: "Night conversation already closed" }\n        }));\n      }\n\n      return res.json(await sendManagedReply({\n        appId, conversationId, messageId, userText,\n        reply: buildAfterHoursClosureReply(),\n        kind: "after_hours_closed_reminder",\n        state, info, channelLabel,\n        resolverDecision: { stage: "after_hours", nextAction: "wait_until_tomorrow", reason: "Night conversation already closed" }\n      }));\n    }\n\n    state.leadScore = calculateLeadScore(state);'''
assert anchor in s
s = s.replace(anchor, replacement, 1)

# Before simple booking, nocturnal explicit scheduling is turned into next-day callback coordination.
anchor = '''    // --- Simple booking conversation: AntonIA stays in control ---\n    if (!state.melania?.active && !state.booking?.awaitingSlotChoice && !state.booking?.chosenSlot) {'''
replacement = '''    // --- Night scheduling: after 21:00 Chile, AntonIA gathers what it can but\n    // does not force a live booking. Carolin continues the next day. ---\n    if (afterHoursContext.active && (hasScheduleIntent(userText) || hasExplicitScheduleIntent(userText))) {\n      markAfterHoursClosed(state);\n      await persistConversationSnapshot(conversationId, state, channelLabel);\n      return res.json(await sendManagedReply({\n        appId, conversationId, messageId, userText,\n        reply: buildAfterHoursClosureReply(),\n        kind: "after_hours_schedule_close",\n        state, info, channelLabel,\n        resolverDecision: { stage: "after_hours", nextAction: "callback_tomorrow", reason: "Schedule request received after 21:00 Chile" }\n      }));\n    }\n\n    // --- Simple booking conversation: AntonIA stays in control ---\n    if (!state.melania?.active && !state.booking?.awaitingSlotChoice && !state.booking?.chosenSlot) {'''
assert anchor in s
s = s.replace(anchor, replacement, 1)

# When FONASAPAD completes at night, show the summary AND close with Carolin.
anchor = '''          if (preevalStep.completed && preevalStep.summary) state.dealDraft.dealValidacionPad = `Preevaluación FONASAPAD completa | ${preevalStep.summary}`;\n          await persistConversationSnapshot(conversationId, state, channelLabel);\n          return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: preevalStep.reply, kind: preevalStep.completed ? "fonasapad_preevaluation_complete" : "fonasapad_preevaluation_question", state, info, channelLabel, resolverDecision: { stage: "fonasapad_preevaluation", nextAction: preevalStep.completed ? "complete" : preevalStep.key, reason: "Conversational FONASAPAD preevaluation" } }));'''
replacement = '''          if (preevalStep.completed && preevalStep.summary) state.dealDraft.dealValidacionPad = `Preevaluación FONASAPAD completa | ${preevalStep.summary}`;\n          if (preevalStep.completed && afterHoursContext.active) {\n            markAfterHoursClosed(state);\n            preevalStep.reply = `${preevalStep.reply}[[MSG]]${buildAfterHoursClosureReply()}`;\n          }\n          await persistConversationSnapshot(conversationId, state, channelLabel);\n          return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: preevalStep.reply, kind: preevalStep.completed ? "fonasapad_preevaluation_complete" : "fonasapad_preevaluation_question", state, info, channelLabel, resolverDecision: { stage: "fonasapad_preevaluation", nextAction: preevalStep.completed ? "complete" : preevalStep.key, reason: "Conversational FONASAPAD preevaluation" } }));'''
assert anchor in s
s = s.replace(anchor, replacement, 1)

# Generic night conversations: after several useful exchanges, close instead of keeping the chat open indefinitely.
anchor = '''    // --- MelanIA activation: when Antonia detects booking intent ---'''
addition = '''    if (afterHoursContext.active && !state.preevaluation?.active && shouldCloseAfterHours(state)) {\n      markAfterHoursClosed(state);\n      await persistConversationSnapshot(conversationId, state, channelLabel);\n      return res.json(await sendManagedReply({\n        appId, conversationId, messageId, userText,\n        reply: buildAfterHoursClosureReply(),\n        kind: "after_hours_general_close",\n        state, info, channelLabel,\n        resolverDecision: { stage: "after_hours", nextAction: "callback_tomorrow", reason: "Night conversation reached useful-turn threshold" }\n      }));\n    }\n\n'''
assert anchor in s
s = s.replace(anchor, addition + anchor, 1)

p.write_text(s)
