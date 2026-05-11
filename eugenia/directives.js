export function parseStructuredAgentDirectives(text) {
  const directives = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const correctionMatch = line.match(/^CORREGIR:\s*([^=]+?)\s*=\s*(.+)$/i);
    if (correctionMatch) {
      directives.push({
        type: "corregir",
        field: correctionMatch[1].trim(),
        value: correctionMatch[2].trim(),
        rawText: line
      });
      continue;
    }

    const pipelineMatch = line.match(/^PIPELINE:\s*(.+)$/i);
    if (pipelineMatch) {
      directives.push({
        type: "pipeline",
        value: pipelineMatch[1].trim(),
        rawText: line
      });
      continue;
    }

    const noteMatch = line.match(/^NOTA:\s*(.+)$/i);
    if (noteMatch) {
      directives.push({
        type: "nota",
        value: noteMatch[1].trim(),
        rawText: line
      });
    }
  }
  return directives;
}
