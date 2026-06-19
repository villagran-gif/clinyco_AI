-- 020-fonasapad-carousel-images.sql
--
-- Extiende fonasapad_queue para guardar TODAS las imágenes del carrusel
-- original, no solo la primera. La cola necesita el set completo para
-- (a) renderizar el preview multi-imagen en el dashboard, (b) re-publicar
-- a IG como CAROUSEL_ALBUM con todos los frames, (c) re-publicar a FB
-- como post multi-foto.
--
-- source_image_urls es JSONB con la forma:
--   [{"url":"https://...", "kind":"image|video-cover|child", "childId":"..."}]
--
-- También se aplica en runtime vía queue/queue-db.js (ensureTable), igual
-- que la 019.

ALTER TABLE fonasapad_queue
  ADD COLUMN IF NOT EXISTS source_image_urls JSONB;

-- Backfill para filas anteriores que solo tenían source_image_url:
-- envolvemos la URL existente en un array de 1 elemento para que el
-- código nuevo lea siempre del JSONB.
UPDATE fonasapad_queue
   SET source_image_urls = jsonb_build_array(
         jsonb_build_object('url', source_image_url, 'kind', 'image')
       )
 WHERE source_image_urls IS NULL
   AND source_image_url IS NOT NULL;
