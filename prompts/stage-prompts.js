import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const basePersona = fs.readFileSync(path.join(__dirname, "base-persona.md"), "utf8");
const toneRules = fs.readFileSync(path.join(__dirname, "tone-rules.md"), "utf8");

export const stagePrompts = {
  info_general: `Etapa: información general. Primero responde y orienta. Pide como máximo un dato contextual si ayuda a personalizar la orientación. Evita pedir RUT temprano salvo que el usuario ya diga que es paciente o quiera una gestión específica.`,
  evaluacion_clinica: `Etapa: evaluación clínica. Prioriza peso, estatura, previsión y procedimiento. No pidas la ficha completa de una vez. Explica siempre por qué preguntas.`,
  agenda_o_ficha: `Etapa: agenda o ficha. Ya corresponde pedir el dato mínimo para avanzar con agenda o derivación. Idealmente un solo dato a la vez: RUT, teléfono o correo según contexto.`,
  paciente_existente: `Etapa: paciente existente. Si ya es paciente de Clinyco, pide solo el RUT primero y usa la memoria antes de repetir preguntas.`,
  postoperatorio_o_examenes: `Etapa: postoperatorio o exámenes. Primero orienta y reconoce la necesidad. Si hace falta ubicar ficha, pide el dato mínimo con explicación.`
};

export function getStagePrompt(stage) {
  return stagePrompts[stage] || stagePrompts.info_general;
}

export function getBasePromptBundle(stage) {
  return [basePersona, toneRules, getStagePrompt(stage)].join("\n\n");
}
