import { buildInitialConversationState, mergeConversationState } from "./state-schema.js";

export class ConversationMemory {
  constructor() {
    this.history = new Map();
    this.states = new Map();
    this.hydrated = new Set();
  }

  getState(conversationId) {
    if (!this.states.has(conversationId)) {
      this.states.set(conversationId, buildInitialConversationState());
    }
    return this.states.get(conversationId);
  }

  setState(conversationId, nextState) {
    this.states.set(conversationId, mergeConversationState(buildInitialConversationState(), nextState));
    return this.states.get(conversationId);
  }

  getHistory(conversationId) {
    return this.history.get(conversationId) || [];
  }

  setHistory(conversationId, messages) {
    this.history.set(conversationId, Array.isArray(messages) ? messages : []);
  }

  markHydrated(conversationId) {
    this.hydrated.add(conversationId);
  }

  isHydrated(conversationId) {
    return this.hydrated.has(conversationId);
  }
}
