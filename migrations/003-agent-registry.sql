-- ============================================================
-- Migration 003: Agent Registry
-- Canonical mapping: Zendesk Admin ID + WAHA phone + name
-- Single source of truth for agent identity across all systems
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_registry (
  id bigserial PRIMARY KEY,
  canonical_name text NOT NULL,               -- "Carolina Cornejo"
  email text,                                  -- carolin@clinyco.cl
  zendesk_admin_id text,                       -- Zendesk Support user ID
  waha_session_name text,                      -- FK to agent_waha_sessions
  waha_phone text,                             -- +56973763009
  role text NOT NULL DEFAULT 'agent',          -- agent | admin | owner
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_registry_email_idx
  ON agent_registry (email) WHERE email IS NOT NULL;

-- ── Seed agents ──

INSERT INTO agent_registry (canonical_name, email, zendesk_admin_id, waha_session_name, waha_phone, role) VALUES
  ('Carolina Cornejo',  'carolin@clinyco.cl',        '30229490880397',  'carolina-cornejo',  '+56973763009',  'agent'),
  ('Camila Alcayaga',   'c_alcayaga@clinyco.cl',     '30229583958797',  'camila',            '+56957091330',  'agent'),
  ('Gabriela Heck',     'gabriela@clinyco.cl',       '39403066594317',  'gabriela',          '+56944547790',  'agent'),
  ('Giselle Santander', 'giselle@clinyco.cl',        NULL,              'giselle',           '+56981549477',  'agent'),
  ('Allison Contreras', 'allison@clinyco.cl',        '29866913338893',  'allison',           '+56934266846',  'agent'),
  ('Dr. Villagran',     'villagran@clinyco.cl',       '395718395711',   NULL,                NULL,            'owner')
ON CONFLICT DO NOTHING;

-- ── Register Allison WAHA session ──

INSERT INTO agent_waha_sessions (session_name, agent_name, agent_phone)
VALUES ('allison', 'Allison Contreras', '+56934266846')
ON CONFLICT (session_name) DO UPDATE SET
  agent_name = EXCLUDED.agent_name,
  agent_phone = EXCLUDED.agent_phone;
