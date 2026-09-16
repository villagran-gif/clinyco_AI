(() => {
  const build=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const deliveries={unknown:'Sin comprobante',accepted:'Aceptado por Meta',sent:'Enviado',delivered:'Entregado',read:'Leído',failed:'Falló'};
  const tone={ok:'#137333',warn:'#8a5300',bad:'#b3261e',info:'#2457a6',muted:'#5f6368'};
  const badge=(text,kind='muted')=>{const e=build('span',text);e.style.cssText=`display:inline-block;padding:4px 8px;border-radius:999px;font-weight:700;white-space:nowrap;color:${tone[kind]||tone.muted};background:${kind==='ok'?'#e6f4ea':kind==='warn'?'#fef7e0':kind==='bad'?'#fce8e6':kind==='info'?'#e8f0fe':'#f1f3f4'}`;return e;};
  const normalize=v=>String(v||'').toLowerCase();
  function whatsappStatus(a){
    if(a.state==='confirm')return {text:'✅ CONFIRMÓ WHATSAPP',kind:'ok'};
    if(a.state==='cancel')return {text:'❌ CANCELÓ WHATSAPP',kind:'bad'};
    if(a.state==='rescheduling')return {text:'🔄 REAGENDANDO',kind:'info'};
    if(a.state==='rescheduled')return {text:'✅ REAGENDADA',kind:'ok'};
    if(a.state==='external_cancelled'||a.state==='external_closed')return {text:'⏹ CERRADA SIN RESPUESTA WHATSAPP',kind:'info'};
    if(a.state==='external_confirmed')return {text:'⏳ SIN RESPUESTA WHATSAPP',kind:'muted'};
    if(a.state==='human'||a.state==='uncertain'||a.error)return {text:a.intent==='confirm'?'⚠️ SÍ RECIBIDO · REVISAR':'⚠️ REQUIERE REVISIÓN',kind:'warn'};
    if(a.state==='sending')return {text:'⏳ ENVÍO POR VERIFICAR',kind:'warn'};
    return {text:'⏳ SIN RESPUESTA',kind:'muted'};
  }
  function medinetStatus(a){
    const m=normalize(a.medinet_status);
    if(a.state==='rescheduled'&&m==='completed')return {text:'✅ REAGENDADA · VERIFICADA',kind:'ok'};
    if(a.verified_at&&m==='confirmado')return {text:'✅ CONFIRMADO EN MEDINET',kind:'ok'};
    if(a.verified_at&&['cancelada','cancelado','re-agendado','reagendado'].includes(m))return {text:'✅ CANCELADA EN MEDINET',kind:'bad'};
    if(a.state==='external_closed'&&a.verified_at)return {text:`✅ ${a.medinet_status||'CITA CERRADA'} EN MEDINET`,kind:'info'};
    if(a.state==='confirm'&&!a.verified_at)return {text:'⚠️ WHATSAPP SÍ · MEDINET PENDIENTE',kind:'warn'};
    if(a.verified_at)return {text:`${a.medinet_status||'Cambio'} · VERIFICADO`,kind:'ok'};
    return {text:'Sin cambio verificado',kind:'muted'};
  }
  const cellWithBadge=(status,detail)=>{const td=build('td');td.append(badge(status.text,status.kind));if(detail){const d=build('div',detail);d.style.cssText='margin-top:5px;font-size:12px;color:#666';td.append(d);}return td;};
  async function start(){
    if(window.reviewAuthReady && !await window.reviewAuthReady)return;
    const root=document.getElementById('tab-daily-report');if(!root)return;
    const box=build('section');box.setAttribute('aria-label','Confirmaciones por WhatsApp');box.style.cssText='border:1px solid #777;border-radius:10px;padding:16px;margin:16px 0;overflow:auto';
    const title=build('h3','Confirmaciones por WhatsApp');
    const description=build('p','Respuesta del paciente por WhatsApp, comprobante de entrega y verificación independiente en Medinet.');
    const legend=build('p','Los estados son independientes: una cita puede estar confirmada en Medinet y seguir esperando respuesta por WhatsApp.');legend.style.cssText='margin:6px 0 12px;color:#b8c7d9;font-size:13px';
    const label=build('label','Fecha de la cita '),date=build('input');date.type='date';date.value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());label.append(date);
    const refresh=build('button','Actualizar confirmaciones');refresh.type='button';
    const status=build('p');status.setAttribute('role','status');
    const summary=build('div');summary.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px';
    const table=build('table'),head=build('thead'),tr=build('tr');
    for(const h of ['Hora','Paciente','Profesional / sede','Teléfono','Confirmación WhatsApp','Entrega WhatsApp','Medinet','Conversación'])tr.append(build('th',h));head.append(tr);table.append(head);
    const body=build('tbody');table.append(body);const attention=build('div');
    box.append(title,description,legend,label,refresh,status,summary,table,attention);root.prepend(box);
    async function load(){refresh.disabled=true;date.disabled=true;body.replaceChildren();summary.replaceChildren();attention.replaceChildren();status.textContent='Consultando confirmaciones…';
      try{const r=await fetch('/api/attendance-direct?date='+encodeURIComponent(date.value),{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);
        const hiddenTrials=data.mode==='live'?data.items.filter(a=>a.trial).length:0;
        const items=data.mode==='live'?data.items.filter(a=>!a.trial):data.items;
        const inbound=data.inboundMode==='chatwoot_bridge'?' · Respuestas: Bridge Chatwoot':data.inboundMode==='meta_direct'?' · Respuestas: Meta directo':'';
        status.textContent=`${items.length} registros reales · ${data.mode==='live'?'Modo real':'Modo de prueba'} · ${data.sendsEnabled?'Envíos WhatsApp habilitados'+inbound:'Envíos WhatsApp detenidos'} · Autoactualización 30 s · Actualizado ${new Date().toLocaleTimeString('es-CL',{timeZone:'America/Santiago'})}${hiddenTrials?` · ${hiddenTrials} prueba(s) ocultas`:''}${data.truncated?' · Se muestran los primeros 500':''}`;
        const counts={wa:0,medinet:0,pending:0,reschedule:0,review:0,cancel:0,external:0};
        const occurrences=new Map();
        for(const a of items){const key=[a.date,a.time,a.patient,a.professional,a.branch].map(normalize).join('|');occurrences.set(key,(occurrences.get(key)||0)+1);}
        for(const a of items){
          if(a.state==='confirm')counts.wa++;
          if(a.verified_at&&normalize(a.medinet_status)==='confirmado')counts.medinet++;
          if(a.state==='pending'||a.state==='sending')counts.pending++;
          if(['rescheduling','rescheduled'].includes(a.state))counts.reschedule++;
          if(a.state==='human'||a.state==='uncertain'||a.error)counts.review++;
          if(a.state==='cancel')counts.cancel++;
          if(String(a.state||'').startsWith('external_'))counts.external++;
          const row=build('tr');
          const duplicateKey=[a.date,a.time,a.patient,a.professional,a.branch].map(normalize).join('|');
          const duplicate=occurrences.get(duplicateKey)>1;
          if(duplicate)row.style.background='#3a2d16';
          row.append(build('td',a.time),build('td',(a.trial?'PRUEBA · ':'')+a.patient),build('td',`${a.professional} / ${a.branch||'—'}`),build('td',a.phone));
          const responseDetail=a.reply?`Respuesta: ${a.reply}`:String(a.state||'').startsWith('external_')?'No requiere respuesta del paciente':'Sin respuesta del paciente';
          const detail=duplicate?`⚠️ Posible registro repetido · ${responseDetail}`:responseDetail;
          row.append(cellWithBadge(whatsappStatus(a),detail));
          row.append(build('td',deliveries[a.delivery]||a.delivery||'—'));
          const verified=a.verified_at?`Verificado ${new Date(a.verified_at).toLocaleString('es-CL',{timeZone:'America/Santiago'})}`:'';
          row.append(cellWithBadge(medinetStatus(a),verified));
          const conversation=build('td');
          if(a.chatwoot_conversation_id){const link=build('a','Abrir Chatwoot');link.href=`https://app.chatwoot.com/app/accounts/162472/conversations/${encodeURIComponent(a.chatwoot_conversation_id)}`;link.target='_blank';link.rel='noopener noreferrer';conversation.append(link);}else conversation.textContent='—';
          row.append(conversation);
          body.append(row);
        }
        const cards=[['✅ WhatsApp · confirmadas',counts.wa,'ok'],['✅ Medinet · confirmadas',counts.medinet,'ok'],['⏳ Pendientes WhatsApp',counts.pending,'muted'],['🔄 Reagendar',counts.reschedule,'info'],['❌ Cancelaron WhatsApp',counts.cancel,'bad'],['⏹ Cerradas/no activas en Medinet',counts.external,'info'],['⚠️ Revisión',counts.review,'warn']];
        for(const [labelText,n,kind] of cards)summary.append(badge(`${labelText}: ${n}`,kind));
        if(!items.length){const empty=build('tr');const td=build('td','No hay confirmaciones directas para esta fecha.');td.colSpan=8;empty.append(td);body.append(empty);}
        if(data.attention.length){attention.append(build('h4','Respuestas que necesitan revisión'));for(const e of data.attention)attention.append(build('p',`${e.phone}: ${e.reply||'Mensaje sin texto'} (${e.state})`));}
      }catch(e){status.textContent=e.message||'No se pudo consultar el registro.';}finally{refresh.disabled=false;date.disabled=false;}}
    refresh.onclick=load;date.onchange=load;
    setInterval(()=>{if(document.visibilityState==='visible'&&!refresh.disabled)load();},30000);
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}});observer.observe(box);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
