import {ensureWorkspace, CrmError} from './crm-workspace.js';

const initialized=new WeakMap();
async function ready(pool){
  await ensureWorkspace(pool);
  if(!initialized.has(pool))initialized.set(pool,pool.query(`CREATE TABLE IF NOT EXISTS crm_user_task_preferences (
    email text PRIMARY KEY, owner text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`).catch(error=>{initialized.delete(pool);throw error;}));
  await initialized.get(pool);
}
function identity(email){
  if(typeof email!=='string'||!email.includes('@'))throw new CrmError(401,'authentication_required');
  return email.trim().toLowerCase();
}
export async function saveMyTaskOwner(pool,email,owner){
  email=identity(email);await ready(pool);
  if(typeof owner!=='string'||!owner||owner.length>80)throw new CrmError(400,'invalid_fields');
  const valid=await pool.query("SELECT 1 FROM crm_options WHERE kind='owner' AND value=$1",[owner]);
  if(!valid.rows.length)throw new CrmError(400,'invalid_fields');
  await pool.query(`INSERT INTO crm_user_task_preferences(email,owner) VALUES($1,$2)
    ON CONFLICT(email) DO UPDATE SET owner=EXCLUDED.owner,updated_at=now()`,[email,owner]);
  return {saved:true,owner};
}
export async function myTasks(pool,email){
  email=identity(email);await ready(pool);
  const owners=(await pool.query("SELECT value FROM crm_options WHERE kind='owner' ORDER BY value")).rows.map(r=>r.value);
  const preference=(await pool.query('SELECT owner FROM crm_user_task_preferences WHERE email=$1',[email])).rows[0]?.owner;
  // Never guess a person's identity from a first name or email local part.
  const owner=owners.includes(preference)?preference:owners.find(value=>value.toLowerCase()===email);
  if(!owner)return {configured:false,owners,counts:null,items:[]};
  const counts=(await pool.query(`SELECT
    count(*) FILTER(WHERE completed_at IS NULL)::int AS pending,
    count(*) FILTER(WHERE completed_at IS NULL AND due_at<now())::int AS overdue,
    count(*) FILTER(WHERE completed_at IS NULL AND due_at>=now() AND due_at<now()+interval '7 days')::int AS upcoming,
    count(*) FILTER(WHERE completed_at IS NULL AND due_at IS NULL)::int AS undated,
    count(*) FILTER(WHERE completed_at IS NOT NULL AND (completed_at AT TIME ZONE 'America/Santiago')::date=(now() AT TIME ZONE 'America/Santiago')::date)::int AS completed
    FROM crm_tasks WHERE owner=$1`,[owner])).rows[0];
  const items=(await pool.query(`WITH categorized AS (
    SELECT t.*,o.details->>'dealName' AS deal_name,CASE
      WHEN completed_at IS NOT NULL THEN 'completed'
      WHEN due_at<now() THEN 'overdue'
      WHEN due_at IS NULL THEN 'undated'
      WHEN due_at<now()+interval '7 days' THEN 'upcoming' ELSE 'later' END AS category
    FROM crm_tasks t JOIN crm_opportunities o ON o.id=t.opportunity_id WHERE t.owner=$1
      AND (completed_at IS NULL OR (completed_at AT TIME ZONE 'America/Santiago')::date=(now() AT TIME ZONE 'America/Santiago')::date)
  ), ranked AS (SELECT *,row_number() OVER(PARTITION BY category ORDER BY due_at ASC NULLS LAST,id) AS rank FROM categorized)
  SELECT * FROM ranked WHERE rank<=5 ORDER BY category,due_at ASC NULLS LAST,id`,[owner])).rows.map(r=>({
    id:r.id,opportunityId:r.opportunity_id,title:r.title,owner:r.owner,type:r.task_type,
    due:r.due_at,status:r.completed_at?'done':'pending',completedAt:r.completed_at,version:r.version,
    dealName:r.deal_name,category:r.category
  }));
  return {configured:true,owner,owners,counts,items,updatedAt:new Date().toISOString()};
}
