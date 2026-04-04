-- Add Danitza Olivera to agent registry
INSERT INTO agent_registry (canonical_name, email, zendesk_admin_id, role)
VALUES ('Danitza Olivera', 'danitzaolivera@clinyco.cl', '40001906261005', 'agent')
ON CONFLICT DO NOTHING;
