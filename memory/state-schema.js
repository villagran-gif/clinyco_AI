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
      lastSupportSearchKey: null,
      likelyClinicalRecordOnly: false,
      caseType: null,
      nextAction: null,
      lastQuestionReason: null,
      lastMissingFields: [],
      lastResolvedContext: null
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
    system: {
      aiEnabled: true,
      humanTakenOver: false,
      assigneeId: null,
      botMessagesSent: 0,
      introducedAsAntonia: false,
      handoffReason: null,
      lastQuestionKey: null,
      lastProcessedUserMessageId: null
    },
    customerMemory: {
      customerId: null,
      isReturning: false,
      totalConversaciones: 0,
      previousSummaries: []
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
    system: { ...baseState.system, ...(persistedState.system || {}) },
    customerMemory: { ...baseState.customerMemory, ...(persistedState.customerMemory || {}) }
  };
}
