Project Overview

Clínyco.IA® is a platform under active development focused on the intelligent classification of medical and commercial leads. Its current core is not designed as just a conversational bot, but as a system capable of reading conversations, structuring relevant patient data, detecting real purchase or treatment intent, and assigning an objective commercial priority to support both conversion and clinical coordination.

At its current stage, the project already implements a lead score classifier that scores each conversation on a 0–100 scale and classifies patients into categories such as cold, warm, or hot, using signals such as BMI, insurance profile, contact data, verified national ID (RUT), identified procedure, conversational engagement, scheduling intent, and channel context. This score is powered by a structured conversation state and is already connected to Zendesk operations, customer memory, and follow-up flows.

On top of that foundation, Clínyco.IA® now works as an intelligence layer for medical customer service and healthcare sales: it receives conversations from Zendesk, interprets intent, organizes clinical and commercial information, maintains patient memory, detects closing opportunities, and activates scheduling or human handoff flows when needed. Conversation is the entry point, but the real goal is classification, prioritization, and improvement of commercial conversion.

Current State

At present, the system already supports:
	•	classifying leads based on conversational and clinical signals
	•	structuring contact, insurance, procedure, and other relevant patient indicators
	•	maintaining conversational memory and historical context per patient
	•	syncing useful information into Zendesk operations
	•	supporting scheduling and commercial follow-up workflows
	•	creating the foundation for more advanced analysis models

In recent iterations, the platform has also become more operationally robust. Recent improvements include:
	•	stronger Zendesk synchronization, using the ticket requester as the canonical identity to avoid syncing data to the wrong user
	•	more reliable lead score synchronization into Zendesk, including requester-based logic and enriched score formatting
	•	improved Medinet integration, with API-first scheduling flows, dual authentication, JWT support for public scheduling endpoints, and more resilient booking fallbacks
	•	safer and more stable booking flows, with reduced silent failures, better handling of unavailable slots, and fallback routes through worker infrastructure when direct access is blocked
	•	stronger conversation persistence and customer memory, allowing structured follow-up and more reliable recovery of context
	•	synchronization of knowledge sources from Google Sheets, making the assistant easier to update operationally without hardcoding everything into the prompt

Product Vision

Clínyco.IA® is being developed as an intelligence platform for medical sales and clinical coordination. The vision is not to remain a text-only chatbot, but to evolve into a system capable of:
	•	classifying prospects with greater precision
	•	analyzing closing patterns
	•	recommending commercial actions
	•	assisting human agents in real time
	•	transforming conversations into operational decisions

Future Expansion — Audio and Coaching

This is no longer aimed at being only a text bot. The goal is to build a commercial and clinical intelligence platform.

Phase 7 — Call Integration

Goal:
	•	incorporate audio calls
	•	capture transcripts
	•	analyze successful calls
	•	measure persuasion and quality

Phase 8 — Effective Call Analysis

Goal:
	•	detect the scripts that convert best
	•	detect frequent objections
	•	identify tone, pacing, and closing moments

Phase 9 — Best Contact Timing Prediction

Goal:
	•	recommend when to reach out
	•	suggest whether text, phone call, or video call is best
	•	detect time windows with the highest probability of reply or conversion

Phase 10 — Real-Time Agent Coach

Goal:
	•	assist the agent on screen
	•	suggest the next script
	•	flag objections
	•	recommend tone and response
	•	eventually provide audio support “in one ear”

Projection

The expected evolution of Clínyco.IA® is to become a much more powerful system by combining several layers of intelligence:
	•	AntonIA® as the text interface
	•	conversation analyst
	•	commercial predictor
	•	medical sales coach

In summary, Clínyco.IA® is designed to become the intelligence engine that connects conversation, scoring, prediction, and operational support to improve both commercial conversion and patient experience.