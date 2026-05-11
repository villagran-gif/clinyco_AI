import { normalizeKey } from "../utils/text.js";

const PROCEDURES = [
  { key: "BALON", label: "Balón gástrico", pipelineId: "BALON", triggers: ["BALON", "BALON GASTRICO", "BALON ELIPSE"] },
  { key: "BARIATRICA", label: "Cirugía bariátrica", pipelineId: "BARIATRICA", triggers: ["BARIATRICA", "BARIATRICA", "MANGA", "BYPASS"] },
  { key: "PLASTICA", label: "Cirugía plástica", pipelineId: "PLASTICA", triggers: ["PLASTICA", "CIRUGIA PLASTICA", "ABDOMINOPLASTIA", "LIPO"] },
  { key: "GENERAL", label: "Cirugía general", pipelineId: "GENERAL", triggers: ["CIRUGIA GENERAL", "HERNIA", "VESICULA", "VESÍCULA"] },
  { key: "CONSULTA_NUTRICION", label: "Consulta nutrición", pipelineId: null, triggers: ["NUTRICION", "NUTRICIONISTA", "NUTRI"] },
  { key: "CONSULTA_PSICOLOGIA", label: "Consulta psicología", pipelineId: null, triggers: ["PSICOLOGIA", "PSICOLOGA", "PSICOLOGO"] },
  { key: "CONSULTA_KINESIOLOGIA", label: "Consulta kinesiología", pipelineId: null, triggers: ["KINESIOLOGIA", "KINESIOLOGO", "KINESIOLOGA", "KINE"] },
  { key: "CONSULTA_MEDICINA", label: "Consulta medicina", pipelineId: null, triggers: ["MEDICINA GENERAL", "MEDICO GENERAL", "MEDICINA INTERNA"] }
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
