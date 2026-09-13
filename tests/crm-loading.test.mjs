import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../review/site/crm-loading.js',import.meta.url),'utf8');
function harness(){
  const intervals=new Map(),timeouts=new Map();let id=0;
  const clock={setInterval:f=>{intervals.set(++id,f);return id;},clearInterval:id=>intervals.delete(id),setTimeout:f=>{timeouts.set(++id,f);return id;},clearTimeout:id=>timeouts.delete(id)};
  const node=()=>({style:{},dataset:{},attrs:{},hidden:true,isConnected:true,textContent:'',setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}});
  const root=node(),bar=node(),fill=node(),status=node(),regions=[node(),node()];
  const context={window:{}};vm.runInNewContext(source,context);
  return {root,bar,fill,status,regions,intervals,timeouts,progress:context.window.createCrmLoadProgress({root,bar,fill,status,regions,clock}),tick(){for(const f of intervals.values())f()},hide(){for(const f of [...timeouts.values()])f()}};
}
test('progress appears before config and never claims a known percentage',()=>{
  const h=harness();h.progress.start();assert.equal(h.root.hidden,false);assert.equal(h.root.dataset.state,'loading');assert.equal(h.fill.style.width,'5%');assert.equal(h.bar.attrs['aria-valuenow'],undefined);assert.ok(h.regions.every(r=>r.attrs['aria-busy']==='true'));
});
test('long waits stay below completion and describe the delay',()=>{
  const h=harness();h.progress.start();for(let i=0;i<1000;i++)h.tick();assert.ok(parseFloat(h.fill.style.width)<=90);assert.match(h.status.textContent,/tardando/);assert.equal(h.root.dataset.state,'loading');h.progress.dispose();assert.equal(h.intervals.size,0);
});
test('received pages advance monotonically; rendering stops the timer',()=>{
  const h=harness();h.progress.start();h.progress.page(100);const first=parseFloat(h.fill.style.width);h.progress.page(200);assert.ok(parseFloat(h.fill.style.width)>first);assert.match(h.status.textContent,/200 recibidos/);h.progress.rendering();h.tick();assert.equal(h.fill.style.width,'95%');assert.equal(h.intervals.size,0);
});
test('only successful completion becomes green, including an empty result',()=>{
  const h=harness();h.progress.start();h.progress.complete('Carga completada. No hay DEALS con estos filtros.');assert.equal(h.fill.style.width,'100%');assert.equal(h.fill.style.backgroundColor,'#228044');assert.equal(h.bar.attrs['aria-valuenow'],'100');assert.equal(h.root.dataset.state,'complete');assert.ok(h.regions.every(r=>r.attrs['aria-busy']==='false'));assert.equal(h.intervals.size,0);h.hide();assert.equal(h.root.hidden,true);
});
test('errors remain visible, are not green, and allow a fresh retry',()=>{
  const h=harness();h.progress.start();h.progress.page(100);h.progress.fail('Error de conexión.');assert.equal(h.root.dataset.state,'error');assert.equal(h.fill.style.backgroundColor,'#b42318');assert.equal(h.bar.attrs['aria-valuenow'],undefined);assert.match(h.status.textContent,/reintentar/);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);h.progress.start();assert.equal(h.root.dataset.state,'loading');assert.equal(h.fill.style.width,'5%');h.progress.dispose();
});
test('starting a new load cancels the previous success-hide timer',()=>{
  const h=harness();h.progress.start();h.progress.complete('Listo');h.progress.start();h.hide();assert.equal(h.root.hidden,false);assert.equal(h.timeouts.size,0);h.progress.dispose();
});
test('auth removes the workspace: loading timers stop when disconnected',()=>{
  const h=harness();h.progress.start();h.root.isConnected=false;h.tick();assert.equal(h.intervals.size,0);h.progress.complete('Listo');assert.notEqual(h.root.dataset.state,'complete');
});
