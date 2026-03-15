# Cambios recomendados en `server.js`

## 1) Importar el resolver

Agrega arriba:

```js
import {
  getNextBestQuestion,
  resolveIdentityAndContext,
  applyResolverToState
} from "./conversation-resolver.js";
```

## 2) Extender `identity` dentro de `getConversationState`

Agrega estas llaves:

```js
caseType: null,
nextAction: null,
lastQuestionReason: null,
lastMissingFields: [],
lastResolvedContext: null,
sellRaw: null,
supportRaw: null,
lastSupportSearchKey: null
```

## 3) Guardar resultados crudos

Dentro de `updateStateFromSellSearch(state, sellData)` agrega:

```js
state.identity.sellRaw = sellData;
```

Y cuando Support encuentre algo, guarda:

```js
state.identity.supportRaw = supportData;
```

## 4) Reemplazar `maybeRunIdentitySearch`

La versión actual depende de RUT para entrar. Eso deja fuera Support en casos donde solo tienes email/teléfono/nombre.

Usa esta versión:

```js
async function maybeRunIdentitySearch(state, info) {
  const rut = state.contactDraft.c_rut;
  const supportSearchKey = [
    state.contactDraft.c_email || "",
    state.contactDraft.c_tel1 || "",
    [state.contactDraft.c_nombres, state.contactDraft.c_apellidos].filter(Boolean).join(" "),
    info.authorDisplayName || "",
    info.sourceProfileName || ""
  ].join("|");

  if (ENABLE_SUPPORT_SEARCH && supportSearchKey.replace(/\|/g, "").trim()) {
    const shouldRunSupport = !state.identity.supportSearchCompleted || state.identity.lastSupportSearchKey !== supportSearchKey;

    if (shouldRunSupport) {
      state.identity.lastSupportSearchKey = supportSearchKey;
      try {
        const supportData = await searchSupportReal({
          email: state.contactDraft.c_email,
          phone: state.contactDraft.c_tel1,
          name: [state.contactDraft.c_nombres, state.contactDraft.c_apellidos].filter(Boolean).join(" "),
          channelDisplayName: info.authorDisplayName,
          sourceProfileName: info.sourceProfileName
        });

        state.identity.supportSearchCompleted = true;
        state.identity.foundInSupport = Boolean(supportData?.found);
        state.identity.supportSummary = supportData?.found
          ? `usuarios_support=${supportData.usersCount}, tickets_support=${supportData.ticketsCount}, ultimo_ticket=${supportData.latestTicketId || ""}`
          : "sin coincidencias en Support";
        state.identity.supportRaw = supportData;

        const firstUser = supportData?.users?.[0] || null;
        if (firstUser) {
          if (!state.contactDraft.c_nombres || !state.contactDraft.c_apellidos) {
            const split = splitNames(firstUser.name || "");
            if (!state.contactDraft.c_nombres && split.nombres) state.contactDraft.c_nombres = split.nombres;
            if (!state.contactDraft.c_apellidos && split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
          }
          if (!state.contactDraft.c_email && firstUser.email) state.contactDraft.c_email = String(firstUser.email).toLowerCase();
          if (!state.contactDraft.c_tel1 && firstUser.phone) {
            const normalizedPhone = normalizePhone(firstUser.phone);
            if (normalizedPhone) {
              state.contactDraft.c_tel1 = normalizedPhone;
              if (!state.contactDraft.c_tel2) state.contactDraft.c_tel2 = normalizedPhone;
            }
          }
        }
      } catch (error) {
        console.error("SUPPORT SEARCH ERROR:", error.message);
        state.identity.supportSearchCompleted = false;
        state.identity.supportSummary = `error_busqueda_support: ${error.message}`;
      }
    }
  }

  if (ENABLE_SELL_SEARCH && rut) {
    if (state.identity.lastSellSearchRut === rut && state.identity.sellSearchCompleted) {
      return;
    }

    state.identity.lastSellSearchRut = rut;
    try {
      const sellData = await searchSellByRut(rut);
      updateStateFromSellSearch(state, sellData);
    } catch (error) {
      console.error("SELL SEARCH ERROR:", error.message);
      state.identity.sellSearchCompleted = false;
      state.identity.sellSummary = `error_busqueda_sell: ${error.message}`;
    }
  }
}
```

## 5) Insertar el resolver antes de `askOpenAI`

Justo después de:

```js
await maybeRunIdentitySearch(state, info);
```

agrega:

```js
const resolvedContext = resolveIdentityAndContext({
  state,
  supportResult: state.identity.supportRaw,
  sellResult: state.identity.sellRaw,
  latestUserText: userText
});

const nextQuestionDecision = getNextBestQuestion(
  state,
  state.identity.supportRaw,
  state.identity.sellRaw,
  userText
);

applyResolverToState(state, nextQuestionDecision);
```

## 6) Reemplazar `shouldTriggerCaseE(state)` por la decisión del resolver

Usa:

```js
if (nextQuestionDecision.shouldDerive) {
  state.identity.likelyClinicalRecordOnly = true;
  state.system.aiEnabled = false;
  state.system.handoffReason = "clinical_record_only";
  const reply = nextQuestionDecision.question;
  addToHistory(conversationId, "assistant", reply);
  const delayMs = calculateHumanDelay(reply);
  await sleep(delayMs);
  await sendConversationReply(appId, conversationId, appendAntoniaIntroduction(state, reply));
  state.system.botMessagesSent += 1;
  return res.json({ ok: true, reply, delayMs, botMessagesSent: state.system.botMessagesSent, resolvedContext });
}
```

## 7) Añadir un desvío antes de OpenAI para preguntas determinísticas

Antes de `let reply = await askOpenAI(conversationId, state);` agrega:

```js
const deterministicQuestion =
  nextQuestionDecision.question &&
  (
    nextQuestionDecision.missingFields?.length > 0 ||
    nextQuestionDecision.caseType === "A" ||
    (nextQuestionDecision.resolved?.foundInSupport && !nextQuestionDecision.resolved?.foundInSell)
  );

if (deterministicQuestion) {
  const reply = appendAntoniaIntroduction(state, nextQuestionDecision.question);
  addToHistory(conversationId, "assistant", reply);
  const delayMs = calculateHumanDelay(reply);
  await sleep(delayMs);

  const latestState = getConversationState(conversationId);
  if (!latestState.system.aiEnabled) {
    return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
  }

  await sendConversationReply(appId, conversationId, reply);
  latestState.system.botMessagesSent += 1;
  if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
    latestState.system.aiEnabled = false;
    latestState.system.handoffReason = latestState.system.handoffReason || "max_bot_messages_reached";
  }

  return res.json({
    ok: true,
    reply,
    delayMs,
    botMessagesSent: latestState.system.botMessagesSent,
    nextQuestionDecision,
    resolvedContext
  });
}
```

## 8) Meter el contexto resuelto dentro de `buildStateSummary`

Agrega:

```js
`caseType=${state.identity.caseType || ""}`,
`nextAction=${state.identity.nextAction || ""}`,
`missingFields=${(state.identity.lastMissingFields || []).join(",")}`,
`supportSummary=${state.identity.supportSummary || ""}`,
```

Con eso, si no hay pregunta determinística, OpenAI igual recibe el caso ya resuelto.
