(() => {
  const $ = id => document.getElementById(id);
  const base = location.hostname === 'localhost' ? 'http://localhost:10000/api/review' : '/api';
  let config = null, loading = null, boardOffset = 0, taskOffset = 0, boardBusy = false, tasksBusy = false;
  let activeOpportunity = null, activeTask = null, activeContact = null;
  const errors = { crm_not_enabled:'El CRM todavía no está activado en el servidor.', crm_unavailable:'No se pudo conectar con la base de datos.', already_in_pipeline:'Este contacto ya está en ese embudo.', changed_by_another_operator:'Otra persona modificó este registro. Cierra el formulario, actualiza y vuelve a abrirlo.', invalid_fields:'Revisa los campos y selecciona valores del catálogo.', origin_not_allowed:'Este sitio no está habilitado para guardar cambios.', contact_not_imported:'El contacto todavía no está importado.' };
  async function api(path, body, method = 'POST') {
    const response = await fetch(`${base}/crm/workspace${path}`, body === undefined ? {cache:'no-store'} : {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) throw new Error(errors[data.error] || 'No se pudo guardar o cargar la información.');
    return data;
  }
  function element(tag, content, className) { const e=document.createElement(tag); if(content!==undefined)e.textContent=content; if(className)e.className=className; return e; }
  function selectOptions(select, items, empty = null, selected = '') {
    select.replaceChildren();
    if(empty!==null){const o=element('option',empty);o.value='';select.append(o);}
    for(const item of items){const o=element('option',typeof item==='string'?item:item.name);o.value=typeof item==='string'?item:item.id;select.append(o);}
    if([...select.options].some(o=>o.value===selected))select.value=selected;
  }
  function links(parent, value) {
    for(const [name,items] of [['Contacto',[value.contact]],['Conversación',value.conversations],['Ficha',[value.record]]]) for(const link of items.filter(Boolean)) {
      const url=new URL(link.url);
      const valid=url.origin==='https://app.chatwoot.com' ? /^\/app\/accounts\/162472\/(contacts|conversations)\/\d+$/.test(url.pathname) : url.origin==='https://clinyco.medinetapp.com' && /^\/pacientes\/ficha\/\d+\/\d+\/$/.test(url.pathname);
      if(!valid || url.search || url.hash)continue;
      const a=element('a',name === 'Contacto' ? link.text : name);a.href=url.href;a.title=name;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);
    }
  }
  function button(text, handler){const b=element('button',text);b.type='button';b.onclick=handler;return b;}
  function populateConfig(){
    selectOptions($('crm-pipeline'),config.pipelines,null,$('crm-pipeline').value);
    selectOptions($('crm-owner-filter'),config.owners,'Todos',$('crm-owner-filter').value);
    selectOptions($('crm-task-owner-filter'),config.owners,'Todos',$('crm-task-owner-filter').value);
    const p=config.pipelines.find(p=>p.id===$('crm-pipeline').value);
    selectOptions($('crm-branch'),p.branches,'Todas',$('crm-branch').value);
  }
  async function ensureConfig(){
    if(config)return;
    if(!loading)loading=api('/config').then(data=>{config=data;populateConfig();}).finally(()=>{loading=null;});
    await loading;
  }
  function boardColumns(){
    const pipeline=config.pipelines.find(p=>p.id===$('crm-pipeline').value);
    $('crm-board').replaceChildren();
    for(const s of pipeline.stages){const col=element('section',undefined,'crm-column');col.dataset.stage=s.id;col.append(element('h4',s.name));$('crm-board').append(col);}
  }
  async function loadBoard(more=false){
    if(boardBusy)return;
    boardBusy=true;
    const controls=['crm-pipeline','crm-branch','crm-owner-filter','crm-board-month','crm-board-all','crm-board-refresh','crm-board-more'];
    controls.forEach(id=>$(id).disabled=true);
    try{
      await ensureConfig();
      if(!more){boardOffset=0;boardColumns();}
      $('crm-workspace-state').textContent='Cargando tablero…';
      const q=new URLSearchParams({pipeline:$('crm-pipeline').value,branch:$('crm-branch').value,owner:$('crm-owner-filter').value,month:$('crm-board-month').value,offset:boardOffset});
      const data=await api(`/opportunities?${q}`);
      for(const item of data.items){
        const card=element('article',undefined,'crm-card');links(card,item.links);
        card.append(element('p',[item.branch,item.owner || 'Sin responsable',...item.labels].filter(Boolean).join(' · ')));
        card.append(button('Editar etapa',()=>openOpportunity(item)),button('Nueva tarea',()=>openTask(null,item)));
        const column=[...$('crm-board').children].find(c=>c.dataset.stage===item.stage);column?.append(card);
      }
      boardOffset+=data.items.length;$('crm-board-more').hidden=!data.more;
      $('crm-workspace-state').textContent=boardOffset ? `${boardOffset} oportunidades cargadas${data.more?' · Hay más resultados':''}.` : 'No hay oportunidades con estos filtros. Agrega contactos desde el directorio inferior.';
    }catch(e){$('crm-workspace-state').textContent=e.message;}
    finally{boardBusy=false;controls.forEach(id=>$(id).disabled=false);}
  }
  const localDate=value=>value?new Date(value).toLocaleString('es-CL'): 'Sin vencimiento';
  async function loadTasks(more=false){
    if(tasksBusy)return;tasksBusy=true;
    const controls=['crm-task-filter','crm-task-owner-filter','crm-tasks-refresh','crm-tasks-more'];controls.forEach(id=>$(id).disabled=true);
    try{
      await ensureConfig();if(!more){taskOffset=0;$('crm-tasks').replaceChildren();}
      $('crm-tasks-state').textContent='Cargando tareas…';
      const q=new URLSearchParams({status:$('crm-task-filter').value,owner:$('crm-task-owner-filter').value,offset:taskOffset});
      const data=await api(`/tasks?${q}`);
      for(const item of data.items){
        const row=element('article',undefined,'crm-task-row');
        row.append(element('strong',item.title,'crm-task-title'));links(row,item.links);
        const overdue=item.status==='pending' && item.due && Date.parse(item.due)<Date.now();
        row.append(element('span',`${overdue?'Vencida · ':''}${localDate(item.due)}`,overdue?'crm-overdue':''));
        row.append(element('span',[item.owner||'Sin responsable',item.type,item.status==='done'?'Realizada':'Pendiente'].filter(Boolean).join(' · ')));
        row.append(button('Editar',()=>openTask(item)),button(item.status==='done'?'Reabrir':'Completar',async event=>{
          const btn=event.currentTarget;btn.disabled=true;
          try{await api(`/tasks/${item.id}`,{...item,status:item.status==='done'?'pending':'done'},'PUT');await loadTasks();}
          catch(e){$('crm-tasks-state').textContent=e.message;}finally{btn.disabled=false;}
        }));$('crm-tasks').append(row);
      }
      taskOffset+=data.items.length;$('crm-tasks-more').hidden=!data.more;
      $('crm-tasks-state').textContent=taskOffset?`${taskOffset} tareas cargadas${data.more?' · Hay más resultados':''}.`:'No hay tareas con estos filtros.';
    }catch(e){$('crm-tasks-state').textContent=e.message;}finally{tasksBusy=false;controls.forEach(id=>$(id).disabled=false);}
  }
  function opportunityFields(saved=null){
    const form=$('crm-op-form'),p=config.pipelines.find(p=>p.id===form.elements.pipeline.value);
    selectOptions(form.elements.stage,p.stages,null,saved?.stage||p.stages[0].id);
    selectOptions(form.elements.branch,p.branches,'Sin sede',saved?.branch||'');
    const field=$('crm-op-labels');field.replaceChildren(element('legend','Etiquetas'));field.hidden=!p.labels.length;
    for(const value of p.labels){const label=element('label'),input=document.createElement('input');input.type='checkbox';input.name='labels';input.value=value;input.checked=saved?.labels.includes(value)||false;label.append(input,document.createTextNode(value));field.append(label);}
  }
  function openOpportunity(item=null,contact=null){
    activeOpportunity=item;activeContact=contact;
    const form=$('crm-op-form');form.reset();
    $('crm-op-heading').textContent=item?'Editar oportunidad':'Agregar a un embudo';$('crm-op-state').textContent='';
    selectOptions(form.elements.pipeline,config.pipelines,null,item?.pipeline||$('crm-pipeline').value);form.elements.pipeline.disabled=!!item;
    selectOptions(form.elements.owner,config.owners,'Sin responsable',item?.owner||'');opportunityFields(item);
    $('crm-op-dialog').showModal();
  }
  window.crmAddContact=async contact=>{try{await ensureConfig();openOpportunity(null,contact);}catch(e){$('crm-workspace-state').textContent=e.message;}};
  $('crm-op-form').elements.pipeline.onchange=()=>opportunityFields();
  $('crm-op-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,b=form.querySelector('[type=submit]');b.disabled=true;
    try{
      const payload={pipeline:form.elements.pipeline.value,stage:form.elements.stage.value,branch:form.elements.branch.value,owner:form.elements.owner.value,labels:[...form.querySelectorAll('[name=labels]:checked')].map(e=>e.value)};
      if(activeOpportunity)payload.version=activeOpportunity.version;
      else payload.contactId=new URL(activeContact.contact.url).pathname.split('/').pop();
      await api(activeOpportunity?`/opportunities/${activeOpportunity.id}`:'/opportunities',payload,activeOpportunity?'PUT':'POST');
      $('crm-op-dialog').close();$('crm-pipeline').value=payload.pipeline;populateConfig();await loadBoard();
    }catch(e){$('crm-op-state').textContent=e.message;}finally{b.disabled=false;}
  };
  function openTask(item=null,opportunity=null){
    activeTask=item;activeOpportunity=opportunity;
    const form=$('crm-task-form');form.reset();$('crm-task-state').textContent='';$('crm-task-heading').textContent=item?'Editar tarea':'Nueva tarea';
    form.elements.title.value=item?.title||'';form.elements.status.value=item?.status||'pending';
    selectOptions(form.elements.owner,config.owners,'Sin responsable',item?.owner||opportunity?.owner||'');
    selectOptions(form.elements.type,config.taskTypes,'Sin tipo',item?.type||'');
    if(item?.due){const date=new Date(item.due);form.elements.due.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    $('crm-task-dialog').showModal();
  }
  $('crm-task-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,b=form.querySelector('[type=submit]');b.disabled=true;
    try{
      const payload={title:form.elements.title.value,owner:form.elements.owner.value,type:form.elements.type.value,status:form.elements.status.value,due:form.elements.due.value?new Date(form.elements.due.value).toISOString():null};
      if(activeTask)payload.version=activeTask.version;else payload.opportunityId=activeOpportunity.id;
      await api(activeTask?`/tasks/${activeTask.id}`:'/tasks',payload,activeTask?'PUT':'POST');$('crm-task-dialog').close();await loadTasks();
    }catch(e){$('crm-task-state').textContent=e.message;}finally{b.disabled=false;}
  };
  $('crm-options-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,b=form.querySelector('button');b.disabled=true;
    try{await api('/options',{kind:form.elements.kind.value,value:form.elements.value.value});config=await api('/config');populateConfig();form.elements.value.value='';$('crm-options-state').textContent='Agregado al catálogo.';}
    catch(e){$('crm-options-state').textContent=e.message;}finally{b.disabled=false;}
  };
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('crm-pipeline').onchange=()=>{populateConfig();loadBoard();};
  for(const id of ['crm-branch','crm-owner-filter','crm-board-month'])$(id).onchange=()=>loadBoard();
  $('crm-board-all').onclick=()=>{$('crm-board-month').value='';loadBoard();};
  $('crm-board-refresh').onclick=()=>loadBoard();$('crm-board-more').onclick=()=>loadBoard(true);
  for(const id of ['crm-task-filter','crm-task-owner-filter'])$(id).onchange=()=>loadTasks();
  $('crm-tasks-refresh').onclick=()=>loadTasks();$('crm-tasks-more').onclick=()=>loadTasks(true);
  window.loadCrmWorkspace=()=>Promise.all([loadBoard(),loadTasks()]);
})();
