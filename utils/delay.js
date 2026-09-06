export function calculateHumanDelay(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return 500;

  // Pausa breve: debe sentirse como chat humano, no como una simulación lenta.
  // La latencia real del modelo ya aporta parte del tiempo de respuesta.
  const chars = cleanText.length;
  const delay = 350 + chars * 6 + Math.floor(Math.random() * 350);
  return Math.min(Math.max(delay, 500), 1600);
}
