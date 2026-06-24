// queue/queue-db.js
//
// Capa de datos para la cola de re-publicación de @fonasapad. La tabla
// se crea en runtime via ensureTable() para que el módulo funcione
// aunque la migration 019 no se haya corrido a mano.
//
// El estado pasa por: pending → (approved → published) | rejected | failed.
// La lógica de "publica sí o sí ese día" vive en el router: cuando un
// candidato se rechaza, el router llama insertNextCandidate() para que
// otro pending tome su lugar inmediatamente.

import crypto from "node:crypto";
import { dbEnabled, getPool } from "../db.js";

let tableEnsured = false;

export async function ensureTable() {
  if (tableEnsured) return;
  if (!dbEnabled()) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS fonasapad_queue (
      id                BIGSERIAL PRIMARY KEY,
      source_account    TEXT NOT NULL,
      source_media_id   TEXT NOT NULL,
      source_permalink  TEXT,
      source_caption    TEXT,
      source_media_type TEXT,
      source_image_url  TEXT NOT NULL,
      source_image_urls JSONB,
      source_timestamp  TIMESTAMPTZ,
      source_engagement INTEGER NOT NULL DEFAULT 0,
      adapted_caption   TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      action_token      TEXT NOT NULL UNIQUE,
      decided_by        TEXT,
      decided_at        TIMESTAMPTZ,
      decision_note     TEXT,
      fonasapad_ig_id   TEXT,
      fonasapad_fb_id   TEXT,
      publish_error     TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Migration 020 idempotente: la primera deploy levanta este ALTER
  // sin tocar nada si la columna ya existe.
  await getPool().query(`
    ALTER TABLE fonasapad_queue
      ADD COLUMN IF NOT EXISTS source_image_urls JSONB
  `);
  await getPool().query(`
    UPDATE fonasapad_queue
       SET source_image_urls = jsonb_build_array(
             jsonb_build_object('url', source_image_url, 'kind', 'image')
           )
     WHERE source_image_urls IS NULL
       AND source_image_url IS NOT NULL
  `);
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_fonasapad_queue_status
       ON fonasapad_queue (status, source_engagement DESC)`,
  );
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_fonasapad_queue_source
       ON fonasapad_queue (source_account, source_media_id)`,
  );
  tableEnsured = true;
}

// Genera un token HMAC para los enlaces externos (botones del WhatsApp).
// 16 bytes random + suficientemente largo para no colisionar.
export function newActionToken() {
  return crypto.randomBytes(24).toString("base64url");
}

// Inserta un candidato. Hace check explícito para evitar duplicar un
// source_media_id que ya pasó por la cola en CUALQUIER estado (pending /
// approved / published / rejected / failed). Devuelve la fila insertada
// o null si ya existía.
//
// Usamos check + insert (no ON CONFLICT) porque la migration 019 no
// declara UNIQUE sobre (source_account, source_media_id); selectNextCandidate
// ya filtra contra listSeenSourceMediaIds() así que el riesgo de race
// condition es bajo y un insert duplicado solo crea un row extra que
// el dashboard mostrará y se puede rechazar.
export async function enqueueCandidate(candidate) {
  await ensureTable();
  if (await isAlreadyEnqueued(candidate.sourceAccount, candidate.sourceMediaId)) {
    return null;
  }
  const token = newActionToken();
  // sourceImageUrls debe ser un array de {url, kind, childId?}. Si solo
  // viene sourceImageUrl, lo envolvemos en un array de 1.
  const imageUrls = candidate.sourceImageUrls
    ?? (candidate.sourceImageUrl ? [{ url: candidate.sourceImageUrl, kind: "image" }] : []);
  if (!imageUrls.length) throw new Error("enqueueCandidate: necesita al menos 1 imagen");
  const result = await getPool().query(
    `INSERT INTO fonasapad_queue (
       source_account, source_media_id, source_permalink, source_caption,
       source_media_type, source_image_url, source_image_urls,
       source_timestamp, source_engagement, adapted_caption, action_token
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      candidate.sourceAccount,
      candidate.sourceMediaId,
      candidate.sourcePermalink ?? null,
      candidate.sourceCaption ?? null,
      candidate.sourceMediaType ?? null,
      imageUrls[0].url,                 // mantenemos la primera por compatibilidad
      JSON.stringify(imageUrls),        // todas, para el carrusel real
      candidate.sourceTimestamp ?? null,
      candidate.sourceEngagement ?? 0,
      candidate.adaptedCaption ?? null,
      token,
    ],
  );
  return result.rows[0] ?? null;
}

export async function isAlreadyEnqueued(sourceAccount, sourceMediaId) {
  await ensureTable();
  const r = await getPool().query(
    `SELECT 1 FROM fonasapad_queue
      WHERE source_account = $1 AND source_media_id = $2
      LIMIT 1`,
    [sourceAccount, sourceMediaId],
  );
  return r.rowCount > 0;
}

export async function getPending() {
  await ensureTable();
  const r = await getPool().query(
    `SELECT * FROM fonasapad_queue
      WHERE status = 'pending'
      ORDER BY source_engagement DESC, id ASC`,
  );
  return r.rows;
}

export async function getById(id) {
  await ensureTable();
  const r = await getPool().query(
    `SELECT * FROM fonasapad_queue WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function getByToken(token) {
  await ensureTable();
  const r = await getPool().query(
    `SELECT * FROM fonasapad_queue WHERE action_token = $1`,
    [token],
  );
  return r.rows[0] ?? null;
}

export async function markDecided(id, { status, decidedBy, note }) {
  await ensureTable();
  const r = await getPool().query(
    `UPDATE fonasapad_queue
        SET status = $2,
            decided_by = $3,
            decided_at = now(),
            decision_note = $4
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [id, status, decidedBy, note ?? null],
  );
  return r.rows[0] ?? null;
}

// Marca un row con el resultado de publicación. Permite distinguir:
//  - status 'published'          → IG ✅ + FB ✅
//  - status 'published_fb_only'  → solo FB (IG falló) — el error de IG queda en publish_error
//  - status 'published_ig_only'  → solo IG (FB falló) — el error de FB queda en publish_error
//  - status 'failed'              → ambas fallaron (lo hace markFailed)
//
// Si se llama después de un retry (ej: solo IG), preserva los IDs anteriores
// si ya estaban — usa COALESCE para no perder fb_id cuando solo se reintenta IG.
export async function markPublished(id, { igId, fbId, igError, fbError }) {
  await ensureTable();
  const hasIg = !!igId;
  const hasFb = !!fbId;
  let status = "failed";
  let errorMsg = null;
  if (hasIg && hasFb) {
    status = "published";
  } else if (hasFb && !hasIg) {
    status = "published_fb_only";
    errorMsg = igError ? `IG: ${igError}` : "IG: sin error reportado pero sin id";
  } else if (hasIg && !hasFb) {
    status = "published_ig_only";
    errorMsg = fbError ? `FB: ${fbError}` : "FB: sin error reportado pero sin id";
  } else {
    // No es lo esperado — el caller debe haber llamado markFailed. Pero por
    // si pasa, registramos los errores combinados.
    errorMsg = [igError && `IG: ${igError}`, fbError && `FB: ${fbError}`].filter(Boolean).join(" | ");
  }
  const r = await getPool().query(
    `UPDATE fonasapad_queue
        SET status          = $2,
            fonasapad_ig_id = COALESCE($3, fonasapad_ig_id),
            fonasapad_fb_id = COALESCE($4, fonasapad_fb_id),
            publish_error   = $5
      WHERE id = $1
      RETURNING *`,
    [id, status, igId ?? null, fbId ?? null, errorMsg],
  );
  return r.rows[0] ?? null;
}

export async function markFailed(id, errorMessage) {
  await ensureTable();
  const r = await getPool().query(
    `UPDATE fonasapad_queue
        SET status = 'failed',
            publish_error = $2
      WHERE id = $1
      RETURNING *`,
    [id, errorMessage],
  );
  return r.rows[0] ?? null;
}

// Lista todos los source_media_id que YA pasaron por la cola en algún
// estado (pending/approved/published/rejected/failed) — para no
// re-proponerlos cuando el worker selecciona el próximo candidato.
export async function listSeenSourceMediaIds() {
  await ensureTable();
  const r = await getPool().query(
    `SELECT source_media_id FROM fonasapad_queue`,
  );
  return new Set(r.rows.map((row) => row.source_media_id));
}

export async function recentHistory(limit = 50) {
  await ensureTable();
  const r = await getPool().query(
    `SELECT * FROM fonasapad_queue
       WHERE status IN ('published', 'published_fb_only', 'published_ig_only', 'rejected', 'failed')
       ORDER BY decided_at DESC NULLS LAST, id DESC
       LIMIT $1`,
    [limit],
  );
  return r.rows;
}

// Lista los rows que están "parcialmente publicados" — útil para que
// el dashboard ofrezca el botón "reintentar IG" o "reintentar FB".
export async function getPartialPublished() {
  await ensureTable();
  const r = await getPool().query(
    `SELECT * FROM fonasapad_queue
       WHERE status IN ('published_fb_only', 'published_ig_only')
       ORDER BY decided_at DESC NULLS LAST, id DESC`,
  );
  return r.rows;
}
