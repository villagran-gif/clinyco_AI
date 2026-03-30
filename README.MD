## 🚀 Project Overview

**Clínyco.IA®** is an AI platform focused on **intelligent medical and commercial lead classification**.

**AntonIA®**, the main AI character on the frontend assisting human agents, proves that this system goes far beyond a simple conversational bot. Under the hood, the platform is a robust engine designed to read conversations, structure relevant patient data, detect real buying or treatment intent, and assign an objective commercial priority to support conversion and clinical coordination.

> 🔒 **Data Security & Privacy Architecture**
> Because Clínyco.IA® processes **sensitive medical and patient data**, security is built into the architecture. All incoming conversational data is immediately pseudonymized and assigned an **alias ID**. The AI engine never evaluates raw Personally Identifiable Information (PII). Instead, all machine learning, scoring, and memory tracking are strictly tied to the behavior of this pseudonymized ID to guarantee absolute patient confidentiality.

At its current stage, **Clínyco.IA®** operates as a powerful **lead score classifier**. It scores each conversation on a **0–100 scale** and classifies leads as **cold, warm, or hot**. 

**🧠 Note on Scoring Logic:** *Our AI dynamically increases or decreases the score based on the behavioral and validation signals of the pseudonymized ID. The score reflects the intent, trust, and friction exhibited by the alias during the conversation, entirely decoupled from the raw personal data.* The model evaluates behavioral signals such as:

* **Verified RUT (National ID):** Evaluates the high-intent action of the user providing their ID and the system verifying its format/validity. The score increases based on this *behavioral milestone* achieved by the alias ID, completely ignoring the actual digits.
* **BMI & Health Data:** Scores the prospect's willingness to share sensitive health metrics and whether those metrics match clinical parameters, evaluated purely under the pseudonym.
* **Contact Data Collection:** Rewards the score when the alias smoothly provides contact methods without dropping off the conversational flow.
* **Insurance Profile:** Factors in the readiness of the pseudonymized user to discuss coverage details.
* **Identified Procedure:** Looks for clarity and specificity regarding the treatment being sought.
* **Conversational Engagement:** Measures response times, depth of answers, and continuous interaction tied to the alias.
* **Scheduling Intent:** Detects language that indicates a clear readiness to book an appointment.
* **Channel Context:** Adapts scoring based on the platform and medium of the conversation.

This scoring layer is deeply integrated with Zendesk operations, customer memory, and downstream follow-up workflows.

---

## ⚡ Current Capabilities

Today, the platform is fully equipped to:

* Classify leads using dynamic conversational and clinical signals.
* Structure contact, insurance, procedure, and patient-related data securely under alias profiles.
* Maintain conversational memory and historical patient context.
* Sync actionable data directly into Zendesk workflows.
* Support complex scheduling and follow-up processes.
* Serve as the foundational architecture for advanced intelligence models.

---

## 📈 Recent Progress

Recent development cycles have focused on making the platform highly reliable and operationally robust for real-world use. Key engineering improvements include:

* Stronger Zendesk synchronization, using the ticket requester as the canonical identity.
* Highly reliable lead score syncing directly into Zendesk.
* Improved Clinic Agenda integration with API-first scheduling flows and robust authentication support.
* Resilient booking flows featuring safer fallbacks and the elimination of silent failures.
* Enhanced conversation persistence and customer memory tracking.
* Automated synchronization of knowledge sources via Google Sheets for seamless operational updates.

---

## 💡 Product Vision

**Clínyco.IA®** is being built as the ultimate intelligence platform for **medical sales and clinical coordination**.

We are actively evolving past text-only chat boundaries into a proactive system capable of:

* Classifying prospects with hyper-accuracy.
* Analyzing deep conversion patterns.
* Recommending optimal commercial actions.
* Assisting human agents in real time.
* Turning raw conversations into direct operational decisions.

---

## 🗺️ Roadmap & Future Expansion: Audio and Coaching

This project is expanding into a comprehensive **commercial and clinical intelligence platform**. We are actively looking for contributors to help us build the following phases:

### Phase 7 — Call Integration
* Incorporate raw audio call ingestion.
* Generate highly accurate transcripts.
* Analyze successful calls to extract key behavioral data.
* Measure agent persuasion and call quality.

### Phase 8 — Effective Call Analysis
* Detect and flag the scripts that convert best.
* Identify frequent objections and hurdles.
* Analyze tone, pacing, and critical closing moments.

### Phase 9 — Best Contact Timing Prediction
* Recommend the exact best moment to reach out to a prospect.
* Suggest the optimal channel (text, phone call, or video).
* Detect specific time windows with the highest probability of reply or conversion based on historical alias behavior.

---

## 🌟 The Ultimate Vision: An Omnipresent AI Co-Pilot

We are taking inspiration from the most advanced conversational intelligence platforms. Just as enterprise SaaS giants use live call analysis to navigate objections, and cutting-edge digital retail platforms use real-time predictive models to suggest high-conversion cross-sells, we are bringing this tier of live cognitive support to medical coordination.

In our final form, **AntonIA®** will act as a true, multi-modal **AI Co-Pilot** operating alongside the agent in real time:

* 💻 **Visually On-Screen:** AntonIA® will monitor the live conversation and instantly surface the **Next Best Action (NBA)** and the **Best Next Question**. She will dynamically update suggested scripts based on real-time sentiment analysis and visibly flag patient objections before the agent even fully registers them.
* 🎧 **Auditorily "In the Ear":** Moving beyond the screen, we are building low-latency audio pipelines so AntonIA® can provide live, unobtrusive audio whispers directly into the agent's headset, offering immediate strategic guidance during complex live phone calls.

**Join the movement:** We are actively looking for visionaries to help us build this. If you are a developer, NLP specialist, or data scientist excited by real-time audio streaming (WebRTC), low-latency LLM inference, predictive behavioral modeling, or complex frontend integrations, this is your playground. Help us build the open-source intelligence engine that merges human empathy with AI precision to redefine the patient experience!
