import { Router, json } from 'express';
import { board, tasks, configuration, addOption, saveOpportunity, saveTask, conversationContact, dealActivity, addDealNote, CrmError } from './crm-workspace.js';
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
  router.use(json({ limit:'24kb' }));
  const route = fn => async (req,res) => {
    try { res.json(await fn(req)); }
    catch(e) { res.status(e instanceof CrmError ? e.status : 503).json({error:e instanceof CrmError ? e.message : 'crm_unavailable'}); }
  };
  router.get('/conversations/:id',route(req=>conversationContact(getPool(),req.params.id)));
  router.get('/config',route(()=>configuration(getPool())));
  router.post('/options',route(async req=>{ await addOption(getPool(),req.body); return {saved:true}; }));
  router.get('/opportunities/:id/activity',route(req=>dealActivity(getPool(),req.params.id,req.query)));
  router.post('/opportunities/:id/notes',route(req=>addDealNote(getPool(),req.params.id,req.body,req.reviewUser?.email)));
  router.get('/opportunities',route(req=>board(getPool(),req.query)));
  router.post('/opportunities',route(req=>saveOpportunity(getPool(),req.body,null,req.reviewUser?.email)));
  router.put('/opportunities/:id',route(req=>saveOpportunity(getPool(),req.body,req.params.id,req.reviewUser?.email)));
  router.get('/tasks',route(req=>tasks(getPool(),req.query)));
  router.post('/tasks',route(req=>saveTask(getPool(),req.body,null,req.reviewUser?.email)));
  router.put('/tasks/:id',route(req=>saveTask(getPool(),req.body,req.params.id,req.reviewUser?.email)));
  router.use((err,req,res,next)=>res.status(err.status===413 ? 413 : 400).json({error:'invalid_json'}));
  return router;
}
