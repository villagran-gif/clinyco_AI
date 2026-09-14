(() => {
  const build=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const states={sending:'Envío por verificar',pending:'Esperando respuesta',confirm:'Confirmó',cancel:'Canceló',human:'Necesita ayuda',uncertain:'Revisión necesaria'};
  const deliveries={unknown:'Sin comprobante',accepted:'Aceptado por Meta',sent:'Enviado',delivered:'Entregado',read:'Leído',failed:'Falló'};
  async function start(){
    if(window.reviewAuthReady && !await window.reviewAuthReady)return;
    const root=document.getElementById('tab-daily-report');if(!root)return;
    const box=build('section');box.setAttribute('aria-label','Confirmaciones por WhatsApp');
    box.style.cssText='border:1px solid #777;border-radius:10px;padding:16px;margin:16px 0;overflow:auto';
    const title=build('h3','Confirmaciones por WhatsApp');
    const description=build('p','Envíos y respuestas del número exclusivo de confirmaciones.');
    const label=build('label','Fecha de confirmaciones '),date=build('input');date.type='date';
    date.value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());label.append(date);
    const refresh=build('button','Actualizar confirmaciones');refresh.type='button';
    const status=build('p');status.setAttribute('role','status');
    const table=build('table'),head=build('thead'),tr=build('tr');
    for(const h of ['Hora','Paciente','Profesional / sede','Teléfono','Respuesta','Estado','WhatsApp','Medinet'])tr.append(build('th',h));head.append(tr);table.append(head);
    const body=build('tbody');table.append(body);const attention=build('div');
    box.append(title,description,label,refresh,status,table,attention);root.prepend(box);
    async function load(){refresh.disabled=true;date.disabled=true;body.replaceChildren();attention.replaceChildren();status.textContent='Consultando confirmaciones…';
      try{const r=await fetch('/api/attendance-direct?date='+encodeURIComponent(date.value),{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);
        status.textContent=`${data.items.length} registros · ${data.mode==='live'?'Modo real':'Modo de prueba'} · ${data.sendsEnabled?'Envíos habilitados':'Envíos detenidos'}${data.truncated?' · Se muestran los primeros 500':''}`;
        for(const a of data.items){const row=build('tr');for(const value of [a.time,(a.trial?'PRUEBA · ':'')+a.patient,`${a.professional} / ${a.branch||'—'}`,a.phone,a.reply||'Sin respuesta',(states[a.state]||a.state)+(a.error?' · Revisar':''),deliveries[a.delivery]||a.delivery,a.verified_at?`${a.medinet_status} · verificado ${new Date(a.verified_at).toLocaleString('es-CL',{timeZone:'America/Santiago'})}`:'Sin cambio verificado'])row.append(build('td',value));body.append(row);}
        if(!data.items.length)body.append(build('tr','No hay confirmaciones directas para esta fecha.'));
        if(data.attention.length){attention.append(build('h4','Respuestas que necesitan revisión'));for(const e of data.attention)attention.append(build('p',`${e.phone}: ${e.reply||'Mensaje sin texto'} (${e.state})`));}
      }catch(e){status.textContent=e.message||'No se pudo consultar el registro.';}finally{refresh.disabled=false;date.disabled=false;}}
    refresh.onclick=load;date.onchange=load;
    // Load only when the existing report becomes visible; no background polling or AI cost.
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}});observer.observe(box);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
