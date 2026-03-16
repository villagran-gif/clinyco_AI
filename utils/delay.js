export function calculateHumanDelay(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return 1000;

  const chars = cleanText.length;
  let delay = 700 + chars * 18 + Math.floor(Math.random() * 700);
  if (chars < 25) delay += 150;
  return Math.min(Math.max(delay, 900), 4500);
}
