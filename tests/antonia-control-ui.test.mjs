import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { JSDOM } = await import(process.env.REVIEW_TEST_JSDOM_PATH);
const html=await readFile(new URL('../review/site/antonia-feedback.html',import.meta.url),'utf8');
const code=await readFile(new URL('../review/site/antonia-control.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(t,fetchImpl) {
  const dom=new JSDOM(html,{url:'https://clinyco-ai.netlify.app/antonia-feedback.html?conversation=123',runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.fetch=fetchImpl;dom.window.reviewAuthReady=Promise.resolve(true);dom.window.eval(code);
  return id=>dom.window.document.getElementById(id);
}
const human={mode:'human_active',revision:2,pause_status:'pause_confirmed',pending:[]};
test('UI displays persistent pause, requires reason, sends expected revision and changes to active',async t=>{
  const calls=[];const $=fixture(t,async(url,options)=>{calls.push({url,options});return Response.json(options?{...human,mode:'bot_active',revision:3}:human)});
  await tick();assert.equal($('antonia-control').hidden,false);assert.equal($('control-resume').disabled,false);
  $('control-resume').click();await tick();assert.equal(calls.length,1);assert.match($('control-result').textContent,/motivo/);
  $('control-reason').value='Atención terminada';$('control-resume').click();await tick();
  const body=JSON.parse(calls[1].options.body);assert.equal(body.expected_revision,2);assert.equal(body.action,'resume');assert.ok(body.requestId);
  assert.equal($('control-resume').disabled,true);assert.equal($('control-pause').disabled,false);
});
test('UI blocks reactivation for pending sends and when status cannot be read',async t=>{
  let fail=false;const $=fixture(t,async()=> fail?Response.json({error:'unavailable'},{status:503}):Response.json({...human,pause_status:'pause_pending',pending:[{id:1}]}));
  await tick();assert.equal($('control-resume').disabled,true);assert.match($('control-status').textContent,/Pausa pendiente/);
  fail=true;$('control-refresh').click();await tick();assert.equal($('control-pause').disabled,true);assert.equal($('control-resume').disabled,true);
});
test('UI handles stale revisions without automatically retrying the mutation',async t=>{
  let writes=0;const $=fixture(t,async(url,options)=>{if(options){writes++;return Response.json({error:'stale_control_revision'},{status:409})}return Response.json(human)});
  await tick();$('control-reason').value='Terminado';$('control-resume').click();await tick();
  assert.equal(writes,1);assert.match($('control-result').textContent,/Actualiza/);assert.equal($('control-resume').disabled,true);
});
