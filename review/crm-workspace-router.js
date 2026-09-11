import { Router, json } from 'express';
import { board, tasks, configuration, addOption, saveOpportunity, saveTask, CrmError } from './crm-workspace.js';
export function workspaceRouter({ getPool, enabled = () => process.env.CRM_WORKSPACE_ENABLED === 'true', allowedOrigins = () => ['https://clinyco-ai.netlify.app', ...(process.env.CRM_ALLOWED_ORIGINS || '').split(',').filter(Boolean)] }) {
  const router = Router();
  router.use((req,res,next) => {
    res.set('Cache-Control','no-store'); res.set('X-Robots-Tag','noindex, nofollow');
    if (!enabled()) return res.status(503).json({error:'crm_not_enabled'});
    // The parent review router authenticates users. Keep same-origin JSON writes as an additional check.
    if (!['GET','HEAD'].includes(req.method)) {
      if (!allowedOrigins().includes(req.get('origin'))) return res.status(403).json({error:'origin_not_allowed'});
      if (!req.is('application/json')) return res.status(415).json({error:'json_required'});
    }
    next();
  });
  router.use(json({ limit:'8kb' }));
  const route = fn => async (req,res) => {
    try { res.json(await fn(req)); }
    catch(e) { res.status(e instanceof CrmError ? e.status : 503).json({error:e instanceof CrmError ? e.message : 'crm_unavailable'}); }
  };
  router.get('/config',route(()=>configuration(getPool())));
  router.post('/options',route(async req=>{ await addOption(getPool(),req.body); return {saved:true}; }));
  router.get('/opportunities',route(req=>board(getPool(),req.query)));
  router.post('/opportunities',route(req=>saveOpportunity(getPool(),req.body)));
  router.put('/opportunities/:id',route(req=>saveOpportunity(getPool(),req.body,req.params.id)));
  router.get('/tasks',route(req=>tasks(getPool(),req.query)));
  router.post('/tasks',route(req=>saveTask(getPool(),req.body)));
  router.put('/tasks/:id',route(req=>saveTask(getPool(),req.body,req.params.id)));
  router.use((err,req,res,next)=>res.status(err.status===413 ? 413 : 400).json({error:'invalid_json'}));
  return router;
}
