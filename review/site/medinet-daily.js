(() => {
  const money = n => n === null ? 'Sin dato' : new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n);
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const el = (tag,text,cls) => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const views = new Map();
  function link(text,url) {const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function makeView(name) {
    const root=document.getElementById(`tab-${name}`), report=name==='daily-report';
    root.append(el('h2',report?'Confirmaciones y cuadratura':'Agenda diaria de Medinet'));
    root.append(el('p',report?'Revisa las citas, la asistencia y el importe esperado por profesional.':'Citas generadas en Medinet, por fecha, sede y profesional.','daily-subtitle'));
    const toolbar=el('div',undefined,'daily-toolbar');
    const field=(text,input)=>{const label=el('label',text);label.append(input);toolbar.append(label);return input;};
    const date=el('input');date.type='date';date.value=today();field('Fecha',date);
    const branch=field('Sede',el('select')),professional=field('Profesional',el('select'));
    const refresh=el('button','Actualizar');refresh.type='button';toolbar.append(refresh);
    for(const [text,delta] of [['Hoy',0],['Mañana',1]]) {const b=el('button',text);b.type='button';b.onclick=()=>{const d=new Date(today()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);date.value=d.toISOString().slice(0,10);load(view);};toolbar.append(b);}
    const state=el('p','Selecciona una fecha.','daily-state');state.setAttribute('role','status');state.setAttribute('aria-live','polite');
    const output=el('div');root.append(toolbar,state,output);
    const view={root,report,date,branch,professional,refresh,toolbar,state,output,data:null,busy:false};
    date.onchange=()=>load(view);refresh.onclick=()=>load(view);branch.onchange=()=>render(view);professional.onchange=()=>render(view);
    return view;
  }
  function options(select,items,all) {const old=select.value;select.replaceChildren(new Option(all,''),...items.map(([id,name])=>new Option(name,id)));if([...select.options].some(o=>o.value===old))select.value=old;}
  async function load(v) {
    if(v.busy)return;v.busy=true;v.toolbar.querySelectorAll('input,select,button').forEach(e=>e.disabled=true);v.output.setAttribute('aria-busy','true');v.output.replaceChildren();v.state.textContent='Consultando citas en Medinet…';
    try {const r=await fetch('/api/medinet/daily?date='+encodeURIComponent(v.date.value),{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'No fue posible cargar la agenda.');v.data=data;
      options(v.branch,[...new Map(data.professionals.map(p=>[p.branchId,p.branch])).entries()],'Todas las sedes');
      options(v.professional,[...new Map(data.professionals.map(p=>[p.key,p.name])).entries()],'Todos los profesionales');
      v.state.textContent=`${data.items.length} citas · Consultado ${new Date(data.syncedAt).toLocaleTimeString('es-CL',{timeZone:'America/Santiago'})} · hora de Chile${data.slotsFresh?'':' · Cupos sin actualización reciente'}`;render(v);
    }catch(e){v.data=null;v.state.textContent=e.message+' Pulsa Actualizar para reintentar.';}
    finally{v.busy=false;v.toolbar.querySelectorAll('input,select,button').forEach(e=>e.disabled=false);v.output.setAttribute('aria-busy','false');}
  }
  function render(v) {
    if(!v.data)return;v.output.replaceChildren();
    const selected=p=>(!v.branch.value||p.branchId===v.branch.value)&&(!v.professional.value||(p.professionalKey||p.key)===v.professional.value);
    const items=v.data.items.filter(selected),people=v.data.professionals.filter(selected);
    const cards=el('div',undefined,'daily-metrics');
    for(const [label,value,cls] of [['Citas',items.filter(a=>!a.cancelled).length,'cyan'],['Confirmadas',items.filter(a=>!a.cancelled&&a.confirmation.startsWith('Confirmada')).length,'green'],['Atendidos',items.filter(a=>a.attended).length,'purple'],['Sin confirmación',items.filter(a=>!a.cancelled&&!a.attended&&!a.confirmation.startsWith('Confirmada')).length,'amber']]) {const c=el('article',undefined,'daily-metric '+cls);c.append(el('strong',value),el('span',label));cards.append(c);}v.output.append(cards);
    if(v.report) {
      const table=tableFor(['Profesional / sede','Libres web','Bloqueados','Ocupadas','Confirmadas','Atendidos','Ausentes','Canceladas','Esperado agenda','Esperado atendidos','Recibido','Diferencia']);
      for(const p of people){const row=el('tr');const expected=p.expectedKnown?money(p.expectedAmount)+(p.missingTariffs?` + ${p.missingTariffs} sin arancel`:''):(p.occupied?'Sin arancel':money(0));
        const attendedExpected=p.attendedExpectedKnown?money(p.attendedExpectedAmount)+(p.attendedMissingTariffs?` + ${p.attendedMissingTariffs} sin arancel`:''):(p.attended?'Sin arancel':money(0));
        for(const value of [p.name+' · '+p.branch,p.free??'Sin dato',p.blocked??'Sin dato',p.occupied,p.confirmed,p.attended,p.absent,p.cancelled,expected,attendedExpected,'Sin integración','Sin integración'])row.append(el('td',value));table.body.append(row);}
      v.output.append(table.wrap);const notes=el('ul',undefined,'daily-notes');for(const text of v.data.limitations)notes.append(el('li',text));v.output.append(notes);
      const tariff=el('details'),summary=el('summary','Configurar arancel por profesional y tipo de cita');tariff.append(summary);
      const form=el('form',undefined,'daily-toolbar'),select=el('select');select.setAttribute('aria-label','Profesional y tipo de cita');
      const choices=[...new Map(items.filter(a=>a.typeId).map(a=>[a.professionalKey+'|'+a.typeId,a])).values()];
      choices.forEach((a,i)=>select.append(new Option(a.professional+' · '+a.type,String(i))));
      const amount=el('input');amount.type='number';amount.min='0';amount.step='1';amount.required=true;amount.placeholder='Arancel CLP';amount.setAttribute('aria-label','Arancel en pesos chilenos');
      const save=el('button','Guardar arancel');save.type='submit';save.disabled=!choices.length;const status=el('span');status.setAttribute('role','status');form.append(select,amount,save,status);tariff.append(form);v.output.append(tariff);
      form.onsubmit=async event=>{event.preventDefault();const a=choices[Number(select.value)];if(!a)return;save.disabled=true;try{const r=await fetch('/api/medinet/daily/tariff',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({professionalKey:a.professionalKey,typeId:a.typeId,amount:Number(amount.value)})});if(!r.ok)throw Error('No se pudo guardar.');await load(v);}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
    }
    if(v.professional.value) {
      const box=el('details'),title=el('summary','Agenda del profesional · hoy y mañana');box.append(title);
      const button=el('button','Preparar mensaje de agenda'),text=el('pre',undefined,'daily-message');button.type='button';box.append(button,text);v.output.append(box);
      button.onclick=async()=>{button.disabled=true;text.textContent='Preparando…';try{const name=v.professional.selectedOptions[0].textContent;const response=await fetch('/api/medinet/professional-agenda?professional='+encodeURIComponent(name),{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);text.textContent=data.message+'\n\nEnvío diario: '+data.delivery.status+' Hora prevista: '+data.delivery.hour+':00 Chile.';}catch(e){text.textContent=e.message;}finally{button.disabled=false;}};
    }
    const table=tableFor(['Hora','Paciente','Profesional','Sede','Atención','Estado Medinet','Confirmación','Arancel','Accesos']);
    for(const a of items){const row=el('tr');for(const value of [a.time,a.patient,a.professional,a.branch,a.type])row.append(el('td',value));
      const status=el('td');status.append(el('span',a.status,'daily-badge '+(a.cancelled?'red':a.attended?'purple':a.confirmation.startsWith('Confirmada')?'green':'amber')));row.append(status,el('td',a.confirmation),el('td',money(a.expectedAmount)));
      const links=el('td',undefined,'daily-links');if(a.phone){links.append(link('Llamar','tel:'+a.phone));const digits=a.phone.replace(/\D/g,'');if(digits.length>=10)links.append(link('WhatsApp','https://wa.me/'+digits));}if(a.email&&/^[^\s@]+@[^\s@]+$/.test(a.email))links.append(link('Email','mailto:'+encodeURIComponent(a.email)));if(a.conversationUrl)links.append(link('Chatwoot',a.conversationUrl));row.append(links);table.body.append(row);}
    if(!items.length){const cell=el('td','No hay citas para esta fecha y estos filtros.');cell.colSpan=9;const row=el('tr');row.append(cell);table.body.append(row);}v.output.append(table.wrap);
  }
  function tableFor(headers){const wrap=el('div',undefined,'daily-table-wrap'),table=el('table'),head=el('thead'),row=el('tr'),body=el('tbody');for(const name of headers)row.append(el('th',name));head.append(row);table.append(head,body);wrap.append(table);return{wrap,body};}
  window.loadDailyMedinet=name=>{if(!views.has(name))views.set(name,makeView(name));const v=views.get(name);if(!v.data)load(v);};
})();
