export function inferBestNextAction(resolverDecision) {
  const stage = resolverDecision?.resolved?.stage || "";
  const nextAction = resolverDecision?.nextAction || "";
  if (stage === "ready_for_handoff" || stage === "handoff_without_call") return "Derivar a coordinación humana";
  if (stage === "schedule_request") return "Buscar horas en Medinet";
  if (stage === "awaiting_measurements") return "Solicitar peso y estatura";
  if (nextAction === "derive_or_send_web") return "Derivar a agente o enviar link agenda web";
  if (nextAction === "schedule") return "Ofrecer agendar evaluación";
  if (nextAction === "collect_ficha") return "Recopilar ficha clínica";
  if (resolverDecision?.shouldDerive) return "Derivar a agente humano";
  return "Continuar recopilando datos";
}

export function compareSuggestedActionToHumanText(aiSuggestedAction, humanText) {
  const aiWords = new Set(
    String(aiSuggestedAction || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
  );
  const humanWords = String(humanText || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3);
  const sharedWords = humanWords.filter(word => aiWords.has(word));
  const matchScore = Math.min(sharedWords.length / Math.max(aiWords.size, humanWords.length, 1), 1);
  const rounded = Math.round(matchScore * 100) / 100;
  const matchType = rounded >= 0.6 ? "same_intent" : rounded >= 0.3 ? "partial_match" : "different_topic";
  return { matchType, matchScore: rounded };
}
