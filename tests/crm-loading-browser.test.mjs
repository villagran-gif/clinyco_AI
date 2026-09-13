import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const jsdomPath=process.env.REVIEW_TEST_JSDOM_PATH;
const JSDOM=jsdomPath?(await import(jsdomPath)).JSDOM:null;
const html=await readFile(new URL('../review/site/index.html',import.meta.url),'utf8');
const progress=await readFile(new URL('../review/site/crm-loading.js',import.meta.url),'utf8');
const workspace=await readFile(new URL('../review/site/crm-workspace.js',import.meta.url),'utf8');
const config={pipelines:[{id:'bar',name:'Bariátrica',branches:['Santiago'],stages:[{id:'candidate',name:'Candidato'}]}],owners:[],dealFields:[],usedBranches:[]};
const deal=id=>({id:String(id),pipeline:'bar',stage:'candidate',branch:'Santiago',owner:'',labels:[],details:{dealName:`Deal de prueba ${id}`},links:{},computed:{}});
const tick=()=>new Promise(r=>setTimeout(r,5));
function setup(handler){
  const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.fetch=async url=>Response.json(await handler(new URL(url,'https://example.test')));
  dom.window.eval(progress);dom.window.eval(workspace);
  return {dom,window:dom.window,$:id=>dom.window.document.getElementById(id)};
}
test('full workspace starts progress before config and completes after all pages render',{skip:!JSDOM},async()=>{
  let releaseConfig,releasePage;const pages=[];
  const h=setup(url=>{
    if(url.pathname.endsWith('/config'))return new Promise(r=>releaseConfig=()=>r(config));
    if(url.pathname.endsWith('/tasks'))return {items:[],more:false};
    pages.push(url.searchParams.get('offset'));
    if(pages.length===1)return {items:[deal(1)],more:true};
    return new Promise(r=>releasePage=()=>r({items:[deal(2)],more:false}));
  });
  try{
    const loading=h.window.loadCrmWorkspace();assert.equal(h.$('crm-load-progress').hidden,false);assert.equal(h.$('crm-board-refresh').disabled,true);
    releaseConfig();await tick();assert.deepEqual(pages,['0','1']);assert.equal(h.$('crm-load-progress').dataset.state,'loading');assert.match(h.$('crm-workspace-state').textContent,/1 recibidos/);
    releasePage();await loading;
    assert.equal(h.$('crm-load-progress').dataset.state,'complete');assert.equal(h.$('crm-deals-table').querySelectorAll('tbody tr').length,2);assert.match(h.$('crm-workspace-state').textContent,/2 DEALS cargados/);assert.equal(h.$('crm-board-refresh').disabled,false);assert.equal(h.$('crm-table-wrap').getAttribute('aria-busy'),'false');
  }finally{h.dom.window.close()}
});
test('empty result is a successful green completion, not a loading row',{skip:!JSDOM},async()=>{
  const h=setup(url=>url.pathname.endsWith('/config')?config:{items:[],more:false});
  try{await h.window.loadCrmWorkspace();assert.equal(h.$('crm-load-progress').dataset.state,'complete');assert.match(h.$('crm-deals-table').textContent,/No hay DEALS/);assert.doesNotMatch(h.$('crm-deals-table').textContent,/Cargando/)}finally{h.dom.window.close()}
});
test('page failure is red and refresh retries cleanly without duplicate rows',{skip:!JSDOM},async()=>{
  let fail=true;
  const h=setup(url=>{if(url.pathname.endsWith('/config'))return config;if(url.pathname.endsWith('/tasks'))return {items:[],more:false};if(fail)throw new Error('Sin conexión');return {items:[deal(1)],more:false}});
  try{await h.window.loadCrmWorkspace();assert.equal(h.$('crm-load-progress').dataset.state,'error');assert.match(h.$('crm-workspace-state').textContent,/reintentar/);assert.equal(h.$('crm-board-refresh').disabled,false);fail=false;await h.$('crm-board-refresh').onclick();assert.equal(h.$('crm-load-progress').dataset.state,'complete');assert.equal(h.$('crm-deals-table').querySelectorAll('tbody tr').length,1)}finally{h.dom.window.close()}
});
test('configuration failure clears busy state and gives retry guidance',{skip:!JSDOM},async()=>{
  const h=setup(()=>{throw new Error('Configuración no disponible')});
  try{await h.window.loadCrmWorkspace();assert.equal(h.$('crm-load-progress').dataset.state,'error');assert.equal(h.$('crm-board-refresh').disabled,false);assert.equal(h.$('crm-table-wrap').getAttribute('aria-busy'),'false')}finally{h.dom.window.close()}
});
