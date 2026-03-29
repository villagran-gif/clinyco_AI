export function buildInitialConversationState() {
  return {
    contactDraft: {
      c_rut: null,
      c_nombres: null,
      c_apellidos: null,
      c_fecha: null,
      c_tel1: null,
      c_tel2: null,
      c_email: null,
      c_aseguradora: null,
      c_modalidad: null,
      c_direccion: null,
      c_comuna: null
    },
    dealDraft: {
      dealPipelineId: null,
      dealOwnerId: null,
      dealSucursal: null,
      dealPeso: null,
      dealEstatura: null,
      dealInteres: null,
      dealUrlMedinet: null,
      dealCirugiasPrevias: null,
      dealCirujanoBariatrico: null,
      dealCirujanoPlastico: null,
      dealCirujanoBalon: null,
      dealCirujanoGeneral: null,
      dealValidacionPad: null,
      dealNumeroFamilia: null,
      dealColab1: null,
      dealColab2: null,
      dealColab3: null
    },
    identity: {
      matchStatus: "no_context",
      customerId: null,
      matchedBy: null,
      requiresUserConfirmation: false,
      safeToUseHistoricalContext: false,
      possibleContexts: [],
      whatsappPhone: null,
      channelExternalId: null,
      channelDisplayName: null,
      sourceProfileName: null,
      channelSourceType: null,
      saysExistingPatient: false,
      lastSellSearchRut: null,
      sellSearchCompleted: false,
      sellContactFound: false,
      sellDealFound: false,
      sellSummary: null,
      sellRaw: null,
      supportSearchCompleted: false,
      foundInSupport: false,
      supportSummary: null,
      supportRaw: null,
      supportInferredRut: null,
      lastSupportSearchKey: null,
      likelyClinicalRecordOnly: false,
      caseType: null,
      nextAction: null,
      lastQuestionReason: null,
      lastMissingFields: [],
      lastResolvedContext: null,
      verifiedRutAt: null,
      verifiedWhatsappAt: null,
      verifiedPairAt: null,
      zendeskRequesterId: null,
      zendeskTicketId: null
    },
    measurements: {
      weightKg: null,
      heightM: null,
      heightCm: null,
      bmi: null,
      bmiCategory: null,
      pendingConfirmation: false,
      proposedWeightKg: null,
      proposedHeightM: null,
      proposedHeightCm: null,
      askedMeasurementInstructions: false
    },
    customerMemory: {
      customerId: null,
      previousConversations: [],
      isReturning: false
    },
    openHelp: {
      asked: false,
      askedAt: null,
      response: null,
      classifiedIntent: null
    },
    booking: {
      pendingSlots: null,
      pendingProfessional: null,
      pendingSpecialty: null,
      awaitingSlotChoice: false,
      awaitingRutVerification: false,
      awaitingPatientData: false,
      awaitingConfirmation: false,
      chosenSlot: null,
      missingFields: null,
      slotReminderSent: false
    },
    system: {
      aiEnabled: true,
      humanTakenOver: false,
      assigneeId: null,
      botMessagesSent: 0,
      introducedAsAntonia: false,
      handoffReason: null,
      lastQuestionKey: null,
      lastInboundMessageId: null,
      lastOutboundFingerprint: null,
      lastOutboundText: null,
      lastOutboundReason: null,
      lastOutboundAt: null
    },
    leadScore: {
      score: 0,
      category: "frío",
      reasons: [],
      calculatedAt: null
    }
  };
}

export function mergeConversationState(baseState, persistedState = {}) {
  return {
    ...baseState,
    ...persistedState,
    contactDraft: { ...baseState.contactDraft, ...(persistedState.contactDraft || {}) },
    dealDraft: { ...baseState.dealDraft, ...(persistedState.dealDraft || {}) },
    identity: { ...baseState.identity, ...(persistedState.identity || {}) },
    measurements: { ...baseState.measurements, ...(persistedState.measurements || {}) },
    customerMemory: { ...baseState.customerMemory, ...(persistedState.customerMemory || {}) },
    openHelp: { ...baseState.openHelp, ...(persistedState.openHelp || {}) },
    booking: { ...baseState.booking, ...(persistedState.booking || {}) },
    system: { ...baseState.system, ...(persistedState.system || {}) },
    leadScore: { ...baseState.leadScore, ...(persistedState.leadScore || {}) }
  };
}
