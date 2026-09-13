import { Router } from 'express';
import { listSuggestions, saveSuggestion, validateSuggestion } from './store.js';

// Mounted behind reviewAuth: exact Google allowlist and same-origin mutations.
export function improvementsRouter({ getPool }) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.get('/', async (_req, res) => {
    try { res.json(await listSuggestions(getPool())); }
    catch { res.status(503).json({ error: 'improvements_unavailable' }); }
  });
  router.post('/', async (req, res) => {
    if (!req.reviewUser?.id) return res.status(401).json({ error: 'authentication_required' });
    let input;
    try { input = validateSuggestion(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try { res.status(201).json({ item: await saveSuggestion(getPool(), req.reviewUser, input) }); }
    catch { res.status(503).json({ error: 'improvements_unavailable' }); }
  });
  return router;
}
