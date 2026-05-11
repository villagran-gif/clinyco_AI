-- ============================================================
-- Seed: Register real agent WAHA sessions
-- ============================================================

INSERT INTO agent_waha_sessions (session_name, agent_name, agent_phone)
VALUES
  ('carolina-cornejo', 'Carolina Cornejo', '+56973763009'),
  ('camila',           'Camila',           '+56957091330'),
  ('gabriela',         'Gabriela',         '+56944547790'),
  ('giselle',          'Giselle',          '+56981549477')
ON CONFLICT (session_name) DO UPDATE SET
  agent_name = EXCLUDED.agent_name,
  agent_phone = EXCLUDED.agent_phone;
