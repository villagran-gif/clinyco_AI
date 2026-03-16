import { normalizeKey } from "../utils/text.js";

const PROCEDURES = [
  { key: "BALON", label: "Balón gástrico", pipelineId: "BALON", triggers: ["BALON", "BALON GASTRICO", "BALON ELIPSE"] },
  { key: "BARIATRICA", label: "Cirugía bariátrica", pipelineId: "BARIATRICA", triggers: ["BARIATRICA", "BARIATRICA", "MANGA", "BYPASS"] },
  { key: "PLASTICA", label: "Cirugía plástica", pipelineId: "PLASTICA", triggers: ["PLASTICA", "CIRUGIA PLASTICA", "ABDOMINOPLASTIA", "LIPO"] },
  { key: "GENERAL", label: "Cirugía general", pipelineId: "GENERAL", triggers: ["CIRUGIA GENERAL", "HERNIA", "VESICULA", "VESÍCULA"] }
];

export function detectProcedure(text) {
  const normalized = normalizeKey(text);
  for (const procedure of PROCEDURES) {
    if (procedure.triggers.some((trigger) => normalized.includes(trigger))) {
      return procedure;
    }
  }
  return null;
}
