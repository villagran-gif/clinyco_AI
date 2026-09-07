from pathlib import Path

p = Path('server.js')
s = p.read_text()

# Cuando AntonIA pide profesional/especialidad, la respuesta siguiente es una consulta de agenda.
old = '''        await persistConversationSnapshot(conversationId, state, channelLabel);
        return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "ok[[MSG]]con qué profesional o especialidad buscas hora?", kind: "schedule_choose_professional", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_professional") }));'''
new = '''        state.booking.awaitingScheduleQuery = true;
        await persistConversationSnapshot(conversationId, state, channelLabel);
        return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "ok[[MSG]]con qué profesional o especialidad buscas hora?", kind: "schedule_choose_professional", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_professional") }));'''
assert s.count(old) >= 2, f'expected 2 schedule prompt blocks, found {s.count(old)}'
s = s.replace(old, new, 2)

anchor = '''      if (isSimpleScheduleRequest(userText) && !parseRequestedCareMode(userText)) {'''
assert anchor in s
interceptor = r'''      if (state.booking?.awaitingScheduleQuery) {
        const scheduleQuery = String(userText || "").trim();
        if (scheduleQuery.length < 2) {
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply: "con qué profesional o especialidad?",
            kind: "schedule_query_retry", state, info, channelLabel,
            resolverDecision: buildResolverQuestionDecision(state, "schedule_query_retry")
          }));
        }

        state.booking.awaitingScheduleQuery = false;
        state.booking.pendingProfessional = scheduleQuery;
        await persistConversationSnapshot(conversationId, state, channelLabel);

        // El worker de Medinet actualmente tiene Antofagasta (39) y telemedicina (2/3).
        // No inventamos una sucursal Santiago: esa agenda presencial pasa a Carolin.
        if (state.booking.preferredMode === "presencial" && state.booking.preferredCity === "Santiago") {
          const schedulingHandoff = await handoffSchedulingToCarolin({
            conversationId, state, channelLabel, reason: "santiago_medinet_branch_not_configured"
          });
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply: schedulingHandoff.reply,
            kind: "schedule_handoff_santiago",
            state, info, channelLabel,
            resolverDecision: { stage: "scheduling_handoff", nextAction: "human_scheduling", reason: "Santiago branch not configured in Medinet worker" }
          }));
        }

        const branchCandidates = state.booking.preferredMode === "telemedicina"
          ? [2, 3]
          : [39];

        let scheduleResult = null;
        let selectedBranchId = null;
        try {
          for (const branchId of branchCandidates) {
            const candidate = await runMedinetAntonia({
              query: scheduleQuery,
              patientPhone: info?.channelDisplayName || info?.authorDisplayName || "",
              patientMessage: userText,
              patientRut: state.contactDraft?.c_rut || "",
              branchId,
            });
            if (candidate?.available_slots?.length) {
              scheduleResult = candidate;
              selectedBranchId = branchId;
              break;
            }
          }
        } catch (scheduleError) {
          console.error("[scheduling] direct Medinet search failed:", scheduleError.message);
        }

        if (!scheduleResult?.available_slots?.length) {
          const schedulingHandoff = await handoffSchedulingToCarolin({
            conversationId, state, channelLabel, reason: "medinet_direct_search_no_slots"
          });
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply: schedulingHandoff.reply,
            kind: "schedule_handoff_no_slots",
            state, info, channelLabel,
            resolverDecision: { stage: "scheduling_handoff", nextAction: "human_scheduling", reason: "Direct Medinet scheduling search returned no slots" }
          }));
        }

        const slots = scheduleResult.available_slots.slice(0, 6).map((slot) => ({
          ...slot,
          branchId: slot.branchId || selectedBranchId,
        }));
        state.booking.pendingSlots = slots;
        state.booking.pendingProfessional = scheduleResult.professional || scheduleQuery;
        state.booking.pendingSpecialty = scheduleResult.specialty || "";
        state.booking.awaitingSlotChoice = true;
        state.booking.slotReminderSent = false;
        await persistConversationSnapshot(conversationId, state, channelLabel);

        const slotLines = slots.map((slot, index) => `${index + 1}- ${slot.date || slot.dataDia} ${slot.time}`).join("\n");
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply: `tengo estas horas[[MSG]]${slotLines}\ncuál te acomoda?`,
          kind: "schedule_direct_slots",
          state, info, channelLabel,
          resolverDecision: { stage: "scheduling", nextAction: "choose_slot", reason: "Direct Medinet slot search" }
        }));
      }

'''
s = s.replace(anchor, interceptor + anchor, 1)
p.write_text(s)

Path('scripts/check_scheduling_query.mjs').write_text(r'''import fs from "node:fs";
const s = fs.readFileSync("server.js", "utf8");
for (const x of [
  "awaitingScheduleQuery = true",
  "medinet_direct_search_no_slots",
  "santiago_medinet_branch_not_configured",
  "? [2, 3]",
  ": [39]",
  "kind: \"schedule_direct_slots\"",
]) if (!s.includes(x)) throw new Error(`missing ${x}`);
console.log("scheduling query checks ok");
''')
