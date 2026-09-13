import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../review/site/medinet-availability.js', import.meta.url), 'utf8');
const context = vm.createContext({}); vm.runInContext(source, context);
const M = context.MedinetAvailability;
const date = new Date().toLocaleDateString('sv-SE', {timeZone:'America/Santiago'});
const slot = (time, libres = 3, total = 4) => ({fecha:date, horas:[time], disponibles:libres, ocupados:total-libres, total});
const prof = (id, time, extra = {}) => ({id,nombre:id === 13 ? 'Rodrigo Villagrán' : 'Otra persona',especialidad:'Cirugía',duracion_cita:20,slots:[slot(time)],...extra});
const data = () => ({syncedAt:new Date().toISOString(),daysAhead:14,sucursales:{
 '2':{nombre:'Telemedicina Médica',profesionales:[prof(13,'10:00')]},
 '39':{nombre:'Antofagasta',profesionales:[prof(13,'10:10'),prof(14,'12:00')]},
 '41':{nombre:'Santiago',profesionales:[prof(13,'14:00')]},
 '4':{nombre:'Calama',profesionales:[prof(14,'15:00')]}
}});
test('occupancy uses exact business boundaries, including 0% and 100%', () => {
 for (const [value,expected] of [[0,'red'],[25,'red'],[25.01,'orange'],[50,'orange'],[50.01,'yellow'],[74.99,'yellow'],[75,'green'],[100,'green'],[null,'unknown'],[NaN,'unknown'],[-1,'unknown']]) assert.equal(M.color(value),expected);
});
test('explicit zero availability survives; absent or inconsistent data is not 0% occupation', () => {
 const full=M.slotInfo(prof(13,'10:00',{slots:[{...slot('10:00',0,4),horas:[]}]}),date);
 assert.equal(full.disponibles,0); assert.equal(full.percentage,100);
 assert.equal(M.slotInfo({slots:[]},date).percentage,null);
 assert.equal(M.slotInfo({slots:[{fecha:date,horas:['10:00']}]},date).percentage,null);
 assert.equal(M.slotInfo({slots:[{...slot('10:00'),ocupados:9}]},date).percentage,null);
 assert.equal(M.slotInfo({slots:[{...slot('10:00'),occupancyKnown:false}]},date).percentage,null);
});
test('professional filtering includes all branches, supports accents and combines with branch', () => {
 assert.deepEqual(Array.from(M.filtered(data(),'13'),p=>p.sucursalId),['2','39','41']);
 assert.equal(M.filtered(data(),'13','41').length,1);
 assert.equal(M.filtered(data(),'__all__','__all__','villagran').length,3);
});
test('cross-branch offered intervals overlap; adjoining times and other professionals do not', () => {
 const d=data(); const matches=M.overlaps(d,13,date);
 assert.equal(matches.length,1); assert.equal(matches[0].a.name,'Telemedicina Médica'); assert.equal(matches[0].b.name,'Antofagasta'); assert.equal(matches[0].knownDuration,true);
 d.sucursales['39'].profesionales[0].slots=[slot('10:20')]; assert.equal(M.overlaps(d,13,date).length,0);
 d.sucursales['39'].profesionales[0].slots=[slot('10:00')]; d.sucursales['39'].profesionales[0].duracion_cita=0;
 assert.equal(M.overlaps(d,13,date)[0].knownDuration,false);
});
test('alerts qualify telemedicine absence and stale data instead of claiming closed agenda', () => {
 assert.ok(!M.alerts(data(),13,date).some(x=>x.includes('Telemedicina por comprobar')));
 assert.ok(M.alerts(data(),14,date).some(x=>x.includes('no equivale a indisponibilidad confirmada')));
 assert.ok(M.alerts({...data(),syncedAt:'2020-01-01'},13,date).some(x=>x.includes('pendientes de actualizar')));
});
const JSDOM=(await import(process.env.REVIEW_TEST_JSDOM_PATH || 'jsdom')).JSDOM;
const html=await readFile(new URL('../review/site/index.html',import.meta.url),'utf8');
function fixture(){
 const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window; w.api=async()=>data(); w.eval(source);return {dom,w,$:id=>w.document.getElementById(id)};
}
test('dropdown resets branch to all professional sites; reload preserves choice; popup uses exact branch',async()=>{
 const h=fixture();try{
 await h.w.loadMedinet();
 assert.equal(h.$('mn-professional').options.length,3);
 h.$('mn-sucursal').value='4';h.$('mn-sucursal').dispatchEvent(new h.w.Event('change'));
 h.$('mn-professional').value='13';h.$('mn-professional').dispatchEvent(new h.w.Event('change'));
 assert.equal(h.$('mn-sucursal').value,'__all__');assert.equal(h.$('mn-sucursal').options.length,4);
 assert.equal(h.$('mn-grid').querySelectorAll('tbody tr').length,3);
 assert.match(h.$('mn-alerts').textContent,/Cupos simultáneos/);
 const button=h.$('mn-grid').querySelector(`button[data-branch="41"][data-date="${date}"]`);button.click();
 assert.equal(h.$('mn-detail-popup').hidden,false);assert.match(h.$('mn-detail-popup').textContent,/Santiago/);
 assert.equal(h.$('mn-detail-popup').querySelector('.mn-hours').textContent,'14:00');
 h.$('mn-detail-close').click(); assert.equal(h.$('mn-detail-popup').hidden,true);assert.equal(h.w.document.activeElement,button);
 button.click();h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(h.$('mn-detail-popup').hidden,true);
 h.$('mn-sucursal').value='41';h.$('mn-sucursal').dispatchEvent(new h.w.Event('change'));await h.w.loadMedinet();
 assert.equal(h.$('mn-sucursal').value,'41');assert.equal(h.$('mn-professional').value,'13');assert.equal(h.$('mn-grid').querySelectorAll('tbody tr').length,1);
 }finally{h.dom.window.close();}
});
test('unknown days remain inspectable; errors preserve data with a warning',async()=>{
 const h=fixture();try{
 await h.w.loadMedinet();h.$('mn-grid').querySelector('button.mn-occupancy-unknown').click();
 assert.match(h.$('mn-detail-popup').textContent,/No aparecen horas libres/);
 assert.match(h.$('mn-detail-popup').textContent,/Telemedicina por comprobar/);
 h.w.api=async()=>{throw Error('offline');};await h.w.loadMedinet();
 assert.match(h.$('mn-alerts').textContent,/Falló la actualización/);assert.ok(h.$('mn-grid').querySelector('table'));
 }finally{h.dom.window.close();}
});
