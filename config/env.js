export function getEnv(name, fallback = null) {
  return process.env[name] ?? fallback;
}

export function getBooleanEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? fallback).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function getNumberEnv(name, fallback = 0) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}
