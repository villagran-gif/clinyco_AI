/**
 * analysis/anthropic-client.js — Shared Anthropic SDK client.
 * Used by: evaluate.js (EugenIA), sentiment-llm.js (sentiment).
 */
import Anthropic from "@anthropic-ai/sdk";

let client = null;

export function getAnthropicClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    client = new Anthropic({ apiKey });
  }
  return client;
}
