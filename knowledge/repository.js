import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { knowledgeSheetDefinitions } from "./sheet-definitions.js";

const knowledgeDir = path.dirname(fileURLToPath(import.meta.url));

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function getKnowledgeFilePath(fileName) {
  return path.join(knowledgeDir, fileName);
}

export function readKnowledgeFile(key) {
  const definition = knowledgeSheetDefinitions.find((item) => item.key === key);
  if (!definition) return null;
  return readJsonFile(getKnowledgeFilePath(definition.fileName));
}

export function readAllKnowledge() {
  return Object.fromEntries(
    knowledgeSheetDefinitions.map((definition) => [
      definition.key,
      readJsonFile(getKnowledgeFilePath(definition.fileName))
    ])
  );
}
