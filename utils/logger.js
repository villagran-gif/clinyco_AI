export function logJson(label, value) {
  try {
    console.log(label, JSON.stringify(value));
  } catch {
    console.log(label, "[unserializable]");
  }
}
