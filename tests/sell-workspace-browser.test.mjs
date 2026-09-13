import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const path=process.env.REVIEW_TEST_JSDOM_PATH,JSDOM=path?(await import(path)).JSDOM:null;
const html=await readFile(new URL('../review/site/index.html',import.meta.url),'utf8');
const shell=await readFile(new URL('../review/site/sell-workspace.js',import.meta.url),'utf8');
const workspace=await readFile(new URL('../review/site/crm-workspace.js',import.meta.url),'utf8');
const progress=await readFile(new URL('../review/site/crm-loading.js',import.meta.url),'utf8');
const config={pipelines:[{id:'bar',name:'Bariátrica',branches:[],stages:[{id:'new',name:'Nuevo'}]}],owners:['Agente Uno'],dealFields:[{key:'value',label:'Valor',type:'number'}]};
const tick=()=>new Promise(r=>setTimeout(r,10));
function fixture(handler){const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
  w.document.documentElement.classList.remove('review-locked');w.document.getElementById('review-user-email').textContent='one@example.test';
  w.fetch=async(url,options)=>{const data=await handler(new URL(url,'https://example.test'),options);return Response.json(data);};
  return {dom,w,$:id=>w.document.getElementById(id)};
}
test('old all-column preferences migrate, 200 rows paginate and sorting applies globally',{skip:!JSDOM},async()=>{
  const items=Array.from({length:401},(_,n)=>({id:String(n+1),pipeline:'bar',stage:'new',details:{dealName:`Deal ${String(n+1).padStart(3,'0')}`,value:n},labels:[],links:{}}));
  const h=fixture(url=>url.pathname.endsWith('/config')?config:url.pathname.endsWith('/tasks')?{items:[],more:false}:{items,more:false});
  try{
    h.w.localStorage.setItem('crm-table:one@example.test',JSON.stringify({version:2,columns:['dealName','value','whatsappUrl']}));
    h.w.eval(progress);h.w.eval(workspace);await h.w.loadCrmWorkspace();
    assert.equal(h.$('crm-deals-table').querySelectorAll('tbody tr').length,200);assert.equal(h.$('crm-deals-table').querySelector('th[data-key="value"]'),null);
    h.$('crm-page-next').click();assert.match(h.$('crm-page-status').textContent,/201–400/);assert.match(h.$('crm-deals-table').querySelector('tbody').textContent,/Deal 201/);
    h.$('crm-page-next').click();assert.equal(h.$('crm-deals-table').querySelectorAll('tbody tr').length,1);assert.equal(h.$('crm-page-next').disabled,true);
    h.$('crm-deals-table').querySelector('th[data-key="dealName"] button').click();assert.match(h.$('crm-deals-table').querySelector('tbody tr').textContent,/Deal 401/);
    const box=[...h.$('crm-column-options').querySelectorAll('label')].find(l=>l.textContent==='Valor').querySelector('input');box.click();assert.ok(h.$('crm-deals-table').querySelector('th[data-key="value"]'));
    h.$('crm-columns-reset').click();assert.equal(h.$('crm-deals-table').querySelector('th[data-key="value"]'),null);
    h.$('crm-page-size').value='400';h.$('crm-page-size').dispatchEvent(new h.w.Event('change'));assert.equal(h.$('crm-deals-table').querySelectorAll('tbody tr').length,400);
  }finally{h.dom.window.close();}
});
test('sidebar collapses after work, expands explicitly and preserves reading preferences',{skip:!JSDOM},async()=>{
  const h=fixture(()=>({configured:false,owners:['Agente Uno'],counts:null,items:[]}));
  try{
    h.w.reviewAuthReady=Promise.resolve(true);h.w.eval(shell);await tick();
    assert.equal(h.$('sidebar-toggle').getAttribute('aria-expanded'),'true');h.$('crm-board-refresh').click();assert.equal(h.$('sidebar-toggle').getAttribute('aria-expanded'),'false');
    h.$('sidebar-toggle').click();h.$('crm-board-refresh').click();assert.equal(h.$('sidebar-toggle').getAttribute('aria-expanded'),'true');
    h.$('reading-size').value='18';h.$('reading-size').dispatchEvent(new h.w.Event('change'));assert.equal(h.w.document.documentElement.style.getPropertyValue('--reading-size'),'18px');
    assert.equal(h.w.localStorage.getItem('sell-workspace:one@example.test:size'),'18');
    assert.equal(h.$('my-tasks-badge').textContent,'Vincular');assert.equal(h.$('my-tasks-settings').open,true);
  }finally{h.dom.window.close();}
});
test('personal tasks show alarms and genuine completions, failures never claim zero tasks and logout clears data',{skip:!JSDOM},async()=>{
  let fail=false,opened;
  const h=fixture(()=>{if(fail)throw new Error('offline');return {configured:true,owner:'Agente Uno',owners:['Agente Uno'],counts:{pending:2,overdue:1,upcoming:1,undated:0,completed:1},items:[{id:'1',title:'Task overdue',category:'overdue',due:'2026-09-01T12:00:00Z'}]};});
  try{
    h.w.openCrmTask=async t=>opened=t;h.w.reviewAuthReady=Promise.resolve(true);h.w.eval(shell);await tick();
    assert.match(h.$('my-tasks-badge').textContent,/1 vencidas/);assert.match(h.$('my-tasks-content').textContent,/¡Buen trabajo!/);
    h.$('my-tasks-content').querySelector('.my-task-item').click();await tick();assert.equal(opened.id,'1');
    fail=true;await h.$('my-tasks-refresh').onclick();assert.equal(h.$('my-tasks-badge').textContent,'Sin actualizar');assert.equal(h.$('my-tasks-content').textContent,'');
    fail=false;await h.$('my-tasks-refresh').onclick();h.w.document.documentElement.classList.add('review-locked');await tick();assert.equal(h.$('my-tasks-content').textContent,'');assert.equal(h.$('my-tasks-owner').options.length,0);
  }finally{h.dom.window.close();}
});
