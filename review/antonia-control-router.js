import { Router } from 'express';
import { controlKey, createControlStore } from '../conversation/control.js';

// Mounted after reviewAuth: all mutations use the existing, verified team allowlist.
export function antoniaControlRouter({ getPool, accountId = () => process.env.CHATWOOT_ACCOUNT_ID || '162472' }) {
  const router = Router();
  const store = createControlStore(getPool);
  const wrap = fn => async (req,res) => {
    if (!req.reviewUser?.id) return res.status(401).json({error:'authentication_required'});
    try { return res.json(await fn(req)); }
    catch (e) { return res.status(e.status || 503).json({error:e.status ? e.message : 'control_unavailable'}); }
  };
  router.get('/:id/control', wrap(req => store.read(controlKey(accountId(),req.params.id))));
  router.post('/:id/control', wrap(req => {
    const {action,reason,requestId,expected_revision} = req.body || {};
    if (!['pause','resume'].includes(action)) return Promise.reject(Object.assign(new Error('invalid_action'),{status:400}));
    return store.change(controlKey(accountId(),req.params.id), {
      mode:action === 'pause' ? 'human_active' : 'bot_active',
      reason, eventId:requestId, expectedRevision:expected_revision,
      actor:`identity:${req.reviewUser.id}`,
    });
  }));
  return router;
}
