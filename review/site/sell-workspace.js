(() => {
  const $=id=>document.getElementById(id),html=document.documentElement;
  const read=key=>{try{return localStorage.getItem(key);}catch{return null;}};
  const write=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  let interacted=false,authenticated=false,busy=false,generation=0;
  const userKey=()=>`sell-workspace:${$('review-user-email').textContent.trim().toLowerCase()}`;
  function collapse(value,persist=true){
    html.classList.toggle('sidebar-collapsed',value);
    const text=value?'Expandir barra lateral':'Colapsar barra lateral',toggle=$('sidebar-toggle');
    toggle.setAttribute('aria-expanded',String(!value));toggle.setAttribute('aria-label',text);toggle.title=text;
    toggle.querySelector('.sidebar-chevron').textContent=value?'»':'«';
    if(persist)write(userKey()+':collapsed',String(value));
  }
  $('sidebar-toggle').onclick=()=>{interacted=true;collapse(!html.classList.contains('sidebar-collapsed'));};
  function beginWork(event){
    if(!authenticated||interacted||event.target.closest('#sidebar-toggle, #reading-settings, #my-tasks'))return;
    if(!event.target.closest('button,a,input,select,textarea,[tabindex]'))return;
    interacted=true;collapse(true);
  }
  // Collapse after the action, keeping the control stable while it is clicked.
  document.querySelector('main.container').addEventListener('click',beginWork);
  document.querySelector('main.container').addEventListener('change',beginWork);
  const applyReading=()=>{
    html.dataset.readingFont=$('reading-font').value;
    html.style.setProperty('--reading-size',$('reading-size').value+'px');
    write(userKey()+':font',$('reading-font').value);write(userKey()+':size',$('reading-size').value);
  };
  $('reading-font').onchange=applyReading;$('reading-size').onchange=applyReading;
  const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  async function request(path='',body){
    const response=await fetch('/api/crm/workspace/my-tasks'+path,body===undefined?{cache:'no-store'}:{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw new Error('No se pudieron actualizar tus tareas. Intenta nuevamente.');
    return response.json();
  }
  function render(data){
    const badge=$('my-tasks-badge'),root=$('my-tasks-content'),owner=$('my-tasks-owner');root.replaceChildren();
    const selection=owner.value;owner.replaceChildren(new Option('Selecciona tu responsable',''));
    for(const value of data.owners)owner.append(new Option(value,value));owner.value=data.owner||selection;
    $('my-tasks-settings').open=!data.configured;
    badge.className='';
    if(!data.configured){badge.textContent='Vincular';$('my-tasks-state').textContent='Vincula tu responsable para ver solamente tus tareas.';return;}
    const c=data.counts;
    badge.textContent=c.overdue?`⚠ ${c.overdue} vencidas · ${c.upcoming} próximas`:`${c.pending} pendientes · ✓ ${c.completed} hoy`;
    badge.className=c.overdue?'tasks-warning':'tasks-neutral';
    $('my-tasks-state').textContent=`${data.owner} · ${c.pending} pendientes · ${c.undated} sin fecha`;
    if(c.completed)root.append(element('p',`✓ ¡Buen trabajo! Completaste ${c.completed} ${c.completed===1?'tarea':'tareas'} hoy.`,'tasks-success'));
    if(!c.pending)root.append(element('p','No tienes tareas pendientes.','tasks-success'));
    const groups=[['overdue','⚠ Vencidas',c.overdue],['upcoming','Próximos 7 días',c.upcoming],['undated','Sin fecha',c.undated],['later','Más adelante',c.pending-c.overdue-c.upcoming-c.undated],['completed','✓ Completadas hoy',c.completed]];
    for(const [key,label,count] of groups){
      if(!count)continue;const section=element('section',undefined,'my-task-group');section.append(element('h3',`${label} · ${count}`));
      for(const item of data.items.filter(t=>t.category===key)){
        const open=element('button',undefined,'my-task-item');open.type='button';open.append(element('strong',item.title));
        if(item.dealName)open.append(element('span',item.dealName));
        open.append(element('small',item.due?new Date(item.due).toLocaleString('es-CL',{timeZone:'America/Santiago',dateStyle:'short',timeStyle:'short'})+' · Chile':'Sin vencimiento'));
        open.onclick=async()=>{try{await window.openCrmTask(item);$('my-tasks').open=false;}catch{$('my-tasks-state').textContent='No se pudo abrir la tarea. Intenta nuevamente.';}};
        section.append(open);
      }
      if(count>5)section.append(element('small',`Mostrando las primeras 5 de ${count}.`));root.append(section);
    }
    const all=element('button','Ver todas mis tareas');all.type='button';all.onclick=()=>{window.showTab('crm');$('crm-task-owner-filter').value=data.owner;$('crm-task-filter').value='all';$('crm-task-owner-filter').dispatchEvent(new Event('change'));$('my-tasks').open=false;$('crm-tasks').scrollIntoView({block:'start'});};root.append(all);
  }
  async function refresh(){
    if(!authenticated||busy||html.classList.contains('review-locked'))return;
    busy=true;const current=generation;$('my-tasks-refresh').disabled=true;
    try{const data=await request();if(current===generation&&!html.classList.contains('review-locked'))render(data);}
    catch(error){if(current===generation){$('my-tasks-badge').textContent='Sin actualizar';$('my-tasks-badge').className='';$('my-tasks-content').replaceChildren();$('my-tasks-state').textContent=error.message;}}
    finally{busy=false;$('my-tasks-refresh').disabled=false;}
  }
  $('my-tasks-refresh').onclick=refresh;$('my-tasks-close').onclick=()=>{$('my-tasks').open=false;$('my-tasks-summary').focus();};
  $('my-tasks').addEventListener('toggle',()=>{if($('my-tasks').open)refresh();});
  $('my-tasks-owner-save').onclick=async()=>{const button=$('my-tasks-owner-save');if(!$('my-tasks-owner').value){$('my-tasks-state').textContent='Selecciona tu responsable antes de guardar.';return;}button.disabled=true;try{await request('/owner',{owner:$('my-tasks-owner').value});await refresh();}catch(error){$('my-tasks-state').textContent=error.message;}finally{button.disabled=false;}};
  document.addEventListener('click',event=>{for(const id of ['my-tasks','reading-settings'])if(!$(id).contains(event.target))$(id).open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){for(const id of ['my-tasks','reading-settings'])if($(id).open){$(id).open=false;$(id).querySelector('summary').focus();}}});
  window.addEventListener('crm-tasks-changed',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  const timer=setInterval(()=>{if(!document.hidden)refresh();},60000);
  const observer=new MutationObserver(()=>{if(html.classList.contains('review-locked')){generation++;authenticated=false;$('my-tasks').open=false;$('my-tasks-content').replaceChildren();$('my-tasks-owner').replaceChildren();$('my-tasks-state').textContent='Inicia sesión para ver tus tareas.';$('my-tasks-badge').textContent='—';}});
  observer.observe(html,{attributes:true,attributeFilter:['class']});
  window.addEventListener('pagehide',()=>{clearInterval(timer);observer.disconnect();});
  window.reviewAuthReady?.then(allowed=>{
    if(!allowed)return;authenticated=true;const stored=read(userKey()+':collapsed');interacted=stored!==null;
    collapse(stored==='true',false);
    $('reading-font').value=read(userKey()+':font')==='system'?'system':'verdana';
    const size=read(userKey()+':size');$('reading-size').value=['14','16','18'].includes(size)?size:'14';applyReading();refresh();
  });
})();
