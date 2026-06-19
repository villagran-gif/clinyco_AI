-- 019-fonasapad-queue.sql
-- Cola de re-publicación de @fonasapad.
--
-- Cada fila representa un POST CANDIDATO seleccionado por el worker
-- selectNextCandidate(): toma el mejor post histórico (últimos 6 meses)
-- de @clinyco.cl o @doctorvillagran que aún no haya sido marcado como
-- consumido (re-publicado o rechazado).
--
-- Lógica "publica sí o sí": el endpoint /api/queue/reject NO salta el día;
-- marca como rechazado y dispara inmediatamente la inserción del siguiente
-- candidato hasta que uno se apruebe. El endpoint /api/queue/approve hace
-- la publicación en IG + FB de @fonasapad usando los helpers de
-- meta-content/, marca el original como consumido y registra quién aprobó.
--
-- También se crea automáticamente en tiempo de ejecución vía
-- queue/queue-db.js (ensureTable), igual que melania_handoffs.

CREATE TABLE IF NOT EXISTS fonasapad_queue (
  id                BIGSERIAL PRIMARY KEY,
  -- Origen del post (de cuál cuenta venía)
  source_account    TEXT NOT NULL,            -- 'clinyco.cl' | 'doctorvillagran'
  source_media_id   TEXT NOT NULL,            -- id del IG media original
  source_permalink  TEXT,                     -- link al post original
  source_caption    TEXT,                     -- caption original
  source_media_type TEXT,                     -- IMAGE | VIDEO | CAROUSEL_ALBUM
  source_image_url  TEXT NOT NULL,            -- url de la imagen para preview
  source_timestamp  TIMESTAMPTZ,              -- fecha del post original
  source_engagement INTEGER NOT NULL DEFAULT 0,
  -- Caption adaptado para @fonasapad (NULL = usa source_caption)
  adapted_caption   TEXT,
  -- Estado del candidato
  status            TEXT NOT NULL DEFAULT 'pending',
    -- 'pending'   = esperando decisión
    -- 'approved'  = aprobado, esperando publicación
    -- 'published' = publicado en fonasapad
    -- 'rejected'  = rechazado, no se vuelve a proponer este source_media_id
    -- 'failed'    = publicación intentada pero falló (error en log)
  -- Token HMAC firmado para los enlaces externos del WhatsApp (Aprobar/Rechazar)
  action_token      TEXT NOT NULL UNIQUE,
  -- Decisión
  decided_by        TEXT,                     -- 'allison' | 'rodrigo' | 'dashboard'
  decided_at        TIMESTAMPTZ,
  decision_note     TEXT,                     -- "rechazado: foto duplicada", etc.
  -- Publicación en fonasapad
  fonasapad_ig_id   TEXT,                     -- id devuelto por createMediaContainer/publish
  fonasapad_fb_id   TEXT,                     -- id devuelto por createPost
  publish_error     TEXT,
  -- Auditoría
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fonasapad_queue_status
  ON fonasapad_queue (status, source_engagement DESC);
CREATE INDEX IF NOT EXISTS idx_fonasapad_queue_source
  ON fonasapad_queue (source_account, source_media_id);
