(() => {
  const $ = id => document.getElementById(id);
  const base = location.hostname === 'localhost' ? 'http://localhost:10000/api/review' : '/api';
  let config = null, loading = null, boardOffset = 0, taskOffset = 0, boardBusy = false, tasksBusy = false;
  const boardProgress = window.createCrmLoadProgress({root:$('crm-load-progress'),bar:$('crm-load-bar'),fill:$('crm-load-fill'),status:$('crm-workspace-state'),regions:[$('crm-table-wrap'),$('crm-board')]});
  window.addEventListener('pagehide',()=>boardProgress.dispose());
  let dealRows=[], tableColumns=[], visibleColumns=[], dealView='table';
  const columnPreferenceVersion=2;
  let columnsReady=false, sortKey='dealName', sortDirection=1, columnFilters={}, savedViews=[], draggedColumn=null;
  const preferenceKey=()=>`crm-table:${$('review-user-email').textContent.trim().toLowerCase()}`;
  function savePreferences(){try{localStorage.setItem(preferenceKey(),JSON.stringify({version:columnPreferenceVersion,columns:visibleColumns,sortKey,sortDirection,filters:columnFilters,views:savedViews}));}catch{}}
  function moveColumn(key,before){if(key===before)return;const next=visibleColumns.filter(k=>k!==key);next.splice(next.indexOf(before),0,key);visibleColumns=next;savePreferences();renderColumnPicker();renderDealTable();}
  function comparable(column,item){
    const raw={createdAt:item.createdAt,stageChangedAt:item.stageChangedAt,closedAt:item.closedAt,nextTaskDue:item.nextTask?.due};
    if(Object.hasOwn(raw,column.key))return raw[column.key]?Date.parse(raw[column.key]):null;
    const value=column.get(item);if(value==null||value==='')return null;
    if(column.type==='number'||['age','bmi','overdueTasks'].includes(column.key))return Number(value);
    return String(value);
  }
  function viewRows(){const col=tableColumns.find(c=>c.key===sortKey);return dealRows.filter(item=>Object.entries(columnFilters).every(([key,value])=>!value||String(tableColumns.find(c=>c.key===key)?.get(item)??'').toLocaleLowerCase('es').includes(value.toLocaleLowerCase('es')))).slice().sort((a,b)=>{if(!col)return 0;const x=comparable(col,a),y=comparable(col,b);if(x===null)return y===null?0:1;if(y===null)return -1;return sortDirection*(typeof x==='number'?x-y:String(x).localeCompare(String(y),'es',{numeric:true,sensitivity:'base'}));});}
  function setupViewTools(){
    const root=element('div',undefined,'crm-toolbar');root.id='crm-saved-views';
    const label=element('label','Vista personal'),select=element('select');select.id='crm-view-saved';label.append(select);
    const nameLabel=element('label','Nombre de la vista'),name=element('input');name.id='crm-view-name';name.maxLength=80;nameLabel.append(name);
    const refresh=()=>{select.replaceChildren(new Option('Vista actual',''));savedViews.forEach((v,i)=>select.append(new Option(v.name,String(i))));};
    const save=duplicate=>{const title=name.value.trim();if(!title){name.focus();return;}const v={name:title,columns:[...visibleColumns],sortKey,sortDirection,filters:{...columnFilters},pipeline:$('crm-pipeline').value,branch:$('crm-branch').value,owner:$('crm-owner-filter').value,month:$('crm-board-month').value};const index=duplicate?-1:savedViews.findIndex(v=>v.name===title);if(index<0)savedViews.push(v);else savedViews[index]=v;savePreferences();refresh();select.value=String(index<0?savedViews.length-1:index);};
    select.onchange=async()=>{const v=savedViews[Number(select.value)];if(select.value===''||!v)return;visibleColumns=v.columns.filter(k=>tableColumns.some(c=>c.key===k));sortKey=v.sortKey;sortDirection=v.sortDirection;columnFilters={...v.filters};name.value=v.name;$('crm-pipeline').value=v.pipeline;populateConfig();$('crm-branch').value=v.branch;$('crm-owner-filter').value=v.owner;$('crm-board-month').value=v.month;savePreferences();renderColumnPicker();await loadBoard();};
    root.append(label,nameLabel,button('Guardar vista',()=>save(false)),button('Duplicar vista',()=>{name.value=(name.value||'Vista')+' (copia)';save(true);}),button('Limpiar filtros de columnas',()=>{columnFilters={};savePreferences();renderDealTable();}));$('crm-table-wrap').before(root);refresh();
    const search=element('input');search.type='search';search.placeholder='Buscar campo';search.setAttribute('aria-label','Buscar campo');search.oninput=()=>{for(const label of $('crm-column-options').children)label.hidden=!label.textContent.toLocaleLowerCase('es').includes(search.value.toLocaleLowerCase('es'));};$('crm-column-options').before(search);
  }
  function editCell(cell,column,item){
    const field=config.dealFields.find(f=>f.key===column.key);if(!field)return;
    cell.replaceChildren();const input=element(field.type==='select'?'select':field.type==='textarea'?'textarea':'input');input.setAttribute('aria-label',`Editar ${column.label}`);if(field.type==='select')selectOptions(input,field.options,'Sin dato');else if(field.type!=='textarea')input.type=field.type;
    input.value=item.details?.[field.key]??'';if(field.maxLength)input.maxLength=field.maxLength;if(field.type==='number'){input.min=field.min;input.max=field.max;input.step=field.step;}
    const error=element('small');error.setAttribute('role','status');
    const save=button('Guardar celda',async()=>{if(!input.reportValidity())return;save.disabled=true;try{const value=input.value===''?null:field.type==='number'?Number(input.value):input.value;await api(`/opportunities/${item.id}`,{pipeline:item.pipeline,stage:item.stage,branch:item.branch,owner:item.owner,labels:item.labels,version:item.version,details:{...item.details,[field.key]:value}},'PUT');await loadBoard();}catch(e){error.textContent=e.message;save.disabled=false;}});
    cell.append(input,save,button('Cancelar edición',()=>renderDealTable()),error);input.focus();
  }
  let activeOpportunity = null, activeTask = null, activeContact = null;
  const errors = { conversation_not_imported:'Esta conversación aún no está sincronizada. Intenta nuevamente en unos minutos.', conversation_contact_mismatch:'La conversación no corresponde al contacto seleccionado.', crm_not_enabled:'El CRM todavía no está activado en el servidor.', crm_unavailable:'No se pudo conectar con la base de datos.', already_in_pipeline:'Este contacto ya está en ese embudo.', changed_by_another_operator:'Otra persona modificó este registro. Cierra el formulario, actualiza y vuelve a abrirlo.', invalid_fields:'Revisa los campos y selecciona valores del catálogo.', origin_not_allowed:'Este sitio no está habilitado para guardar cambios.', contact_not_imported:'El contacto todavía no está importado.' };
  async function api(path, body, method = 'POST') {
    const response = await fetch(`${base}/crm/workspace${path}`, body === undefined ? {cache:'no-store'} : {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) throw new Error(errors[data.error] || (response.status===400 && String(data.error).startsWith('Revisa el campo') ? data.error : 'No se pudo guardar o cargar la información.'));
    return data;
  }
  function element(tag, content, className) { const e=document.createElement(tag); if(content!==undefined)e.textContent=content; if(className)e.className=className; return e; }
  function selectOptions(select, items, empty = null, selected = '') {
    select.replaceChildren();
    if(empty!==null){const o=element('option',empty);o.value='';select.append(o);}
    for(const item of items){const o=element('option',typeof item==='string'?item:item.name);o.value=typeof item==='string'?item:item.id;select.append(o);}
    if([...select.options].some(o=>o.value===selected))select.value=selected;
  }
  function links(parent, value = {}) {
    value ||= {};
    for(const [name,items] of [['Contacto',[value.contact]],['Conversación',value.conversations||[]],['Ficha',[value.record]]]) for(const link of items.filter(Boolean)) {
      let url;try{url=new URL(link.url);}catch{continue;}
      const valid=url.origin==='https://app.chatwoot.com' ? /^\/app\/accounts\/162472\/(contacts|conversations)\/\d+$/.test(url.pathname) : url.origin==='https://clinyco.medinetapp.com' && /^\/pacientes\/ficha\/\d+\/\d+\/$/.test(url.pathname);
      if(!valid || url.username || url.password || url.search || url.hash)continue;
      const a=element('a',name === 'Contacto' ? link.text : name === 'Conversación' ? `Conversación #${url.pathname.split('/').pop()}` : name);a.href=url.href;a.title=name;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);
    }
  }
  function button(text, handler){const b=element('button',text);b.type='button';b.onclick=handler;return b;}
  function populateConfig(){
    selectOptions($('crm-pipeline'),config.pipelines,null,$('crm-pipeline').value);
    selectOptions($('crm-owner-filter'),config.owners,'Todos',$('crm-owner-filter').value);
    selectOptions($('crm-task-owner-filter'),config.owners,'Todos',$('crm-task-owner-filter').value);
    const p=config.pipelines.find(p=>p.id===$('crm-pipeline').value);
    selectOptions($('crm-branch'),[...new Set([...p.branches,...(config.usedBranches||[]).filter(r=>r.pipeline_id===p.id).map(r=>r.branch)])],'Todas',$('crm-branch').value);
  }
  async function ensureConfig(){
    if(config)return;
    if(!loading)loading=api('/config').then(data=>{config=data;populateConfig();}).finally(()=>{loading=null;});
    await loading;
  }
  function setupTableColumns(){
    if(columnsReady || !config)return;
    const name=item=>item.details?.dealName || item.links?.contact?.text || 'Sin nombre';
    tableColumns=[{key:'dealName',label:'Nombre del trato',get:name},
      {key:'id',label:'ID del trato',get:i=>i.sourceId || i.id},
      {key:'stage',label:'Fase del pipeline',get:i=>config.pipelines.find(p=>p.id===i.pipeline)?.stages.find(s=>s.id===i.stage)?.name},
      {key:'owner',label:'Propiedad / Responsable',get:i=>i.owner},
      {key:'branch',label:'Sucursal',get:i=>i.branch},
      {key:'createdAt',label:'Agregado el',get:i=>i.createdAt?localDate(i.createdAt):null},
      ...(config.dealFields || []).filter(f=>f.key!=='dealName').map(f=>({key:f.key,label:f.label,get:i=>i.details?.[f.key] ?? (f.key==='medinetUrl'?i.links?.record?.url:null),type:f.type})),
      {key:'labels',label:'Etiquetas',get:i=>i.labels.join(', ')},
      {key:'stageChangedAt',label:'Fecha de cambio de fase',get:i=>i.stageChangedAt?localDate(i.stageChangedAt):null},
      {key:'closedAt',label:'Fecha de cierre',get:i=>i.closedAt?localDate(i.closedAt):null},
      {key:'age',label:'Edad',get:i=>i.computed?.age},
      {key:'bmi',label:'IMC',get:i=>i.computed?.bmi},
      {key:'whatsappUrl',label:'WhatsApp',get:i=>i.computed?.whatsappUrl,type:'url'},
      {key:'nextTask',label:'Próxima tarea',get:i=>i.nextTask?.title},
      {key:'nextTaskDue',label:'Vencimiento próxima tarea',get:i=>i.nextTask?.due?localDate(i.nextTask.due):null},
      {key:'overdueTasks',label:'Tareas vencidas',get:i=>i.overdueTasks}];
    let prefs={};try{prefs=JSON.parse(localStorage.getItem(preferenceKey()))||{};}catch{}
    let stored=prefs.columns;sortKey=prefs.sortKey||'dealName';sortDirection=prefs.sortDirection===-1?-1:1;columnFilters=prefs.filters||{};savedViews=Array.isArray(prefs.views)?prefs.views:[];
    const allColumns=tableColumns.map(column=>column.key);
    visibleColumns=prefs.version===columnPreferenceVersion&&Array.isArray(stored)?stored.filter(k=>allColumns.includes(k)):allColumns;
    if(!visibleColumns.includes('dealName'))visibleColumns.unshift('dealName');
    columnsReady=true;renderColumnPicker();setupViewTools();
  }
  function renderColumnPicker(){
    const root=$('crm-column-options');root.replaceChildren();
    for(const column of tableColumns){
      const label=element('label'),box=element('input');box.type='checkbox';box.checked=visibleColumns.includes(column.key);box.disabled=column.key==='dealName';
      box.onchange=()=>{visibleColumns=box.checked?[...visibleColumns,column.key]:visibleColumns.filter(k=>k!==column.key);savePreferences();renderDealTable();};
      label.append(box,document.createTextNode(column.label));root.append(label);
    }
  }
  function renderDealTable(){
    setupTableColumns();if(!columnsReady)return;
    const table=$('crm-deals-table'),head=table.querySelector('thead'),body=table.querySelector('tbody');head.replaceChildren();body.replaceChildren();
    const columns=visibleColumns.map(key=>tableColumns.find(c=>c.key===key)).filter(Boolean),tr=element('tr');
    for(const column of columns){
      const th=element('th');th.scope='col';th.draggable=true;th.dataset.key=column.key;th.setAttribute('aria-sort',sortKey===column.key?(sortDirection===1?'ascending':'descending'):'none');
      th.ondragstart=e=>{draggedColumn=column.key;e.dataTransfer.setData('text/plain',column.key);};th.ondragover=e=>e.preventDefault();th.ondrop=e=>{e.preventDefault();if(visibleColumns.includes(draggedColumn))moveColumn(draggedColumn,column.key);};
      const sort=button(column.label+(sortKey===column.key?(sortDirection===1?' ↑':' ↓'):' ↕'),()=>{sortDirection=sortKey===column.key?-sortDirection:1;sortKey=column.key;savePreferences();renderDealTable();});sort.title='Ordenar ascendente / descendente';th.append(sort);
      sort.title='Clic para ordenar · Arrastra para mover · Alt + flechas para mover con teclado';
      sort.onkeydown=e=>{if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const index=visibleColumns.indexOf(column.key);if(e.key==='ArrowLeft'&&index>0)moveColumn(column.key,visibleColumns[index-1]);if(e.key==='ArrowRight'&&index<visibleColumns.length-1)moveColumn(visibleColumns[index+1],column.key);table.querySelector(`th[data-key="${column.key}"] button`)?.focus();};
      tr.append(th);
    }head.append(tr);
    for(const item of viewRows()){
      const row=element('tr');
      for(const column of columns){
        const cell=element('td'),value=column.get(item);
        if(column.key==='dealName'){const open=button(value,()=>openOpportunity(item));open.className='crm-deal-name';cell.append(open);}
        else if(['phone','email'].includes(column.key) && fieldLink(column.key,value)){cell.append(fieldLink(column.key,value));}
        else if(column.type==='url' && value){
          let url;try{url=new URL(value);}catch{}
          const valid=url && url.protocol==='https:' && !url.username && !url.password && !url.port && (column.key==='medinetUrl'?url.hostname==='clinyco.medinetapp.com' && /^\/pacientes\/ficha\/(?:\d+\/\d+|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?:\/\d+)?)\/?$/i.test(url.pathname):column.key==='whatsappUrl'?url.hostname==='wa.me' && /^\/\d+$/.test(url.pathname):url.hostname==='drive.google.com');
          if(valid){const a=element('a',column.key==='medinetUrl'?'Ficha Medinet':column.key==='whatsappUrl'?'WhatsApp':'Exámenes');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';cell.append(a);}else cell.textContent='—';
        }else cell.textContent=value===null || value===undefined || value===''?'—':column.key==='value'?new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value):String(value);
        if(config.dealFields.some(f=>f.key===column.key)){const edit=button('✎',()=>editCell(cell,column,item));edit.setAttribute('aria-label',`Editar ${column.label}`);edit.className='crm-inline-edit';cell.append(edit);}
        if(column.key==='overdueTasks' && Number(value)>0)cell.className='crm-overdue';row.append(cell);
      }
      body.append(row);
    }
    if(!viewRows().length){const row=element('tr'),cell=element('td',boardBusy?'Cargando DEALS…':'No hay DEALS con los filtros seleccionados.');cell.colSpan=columns.length;row.append(cell);body.append(row);}
  }
  function changeDealView(view){
    dealView=view;$('crm-table-wrap').hidden=view!=='table';$('crm-column-picker').hidden=view!=='table';$('crm-board').hidden=view!=='board';
    $('crm-view-table').setAttribute('aria-pressed',String(view==='table'));$('crm-view-board').setAttribute('aria-pressed',String(view==='board'));
  }
  $('crm-view-table').onclick=()=>changeDealView('table');$('crm-view-board').onclick=()=>changeDealView('board');
  $('crm-columns-reset').onclick=()=>{visibleColumns=tableColumns.map(column=>column.key);savePreferences();renderColumnPicker();renderDealTable();};
  function boardColumns(){
    const pipeline=config.pipelines.find(p=>p.id===$('crm-pipeline').value);
    $('crm-board').replaceChildren();
    for(const s of pipeline.stages){const col=element('section',undefined,'crm-column');col.dataset.stage=s.id;col.append(element('h4',s.name));$('crm-board').append(col);}
  }
  async function loadBoard(more=false){
    if(boardBusy)return;
    boardBusy=true;
    boardProgress.start();
    const controls=['crm-pipeline','crm-branch','crm-owner-filter','crm-board-month','crm-board-all','crm-board-refresh','crm-board-more','crm-view-saved'];
    controls.forEach(id=>{if($(id))$(id).disabled=true;});
    try{
      await ensureConfig();
      if(!more){boardOffset=0;dealRows=[];boardColumns();renderDealTable();}
      if($('crm-view-saved'))$('crm-view-saved').disabled=true;
      const q=new URLSearchParams({pipeline:$('crm-pipeline').value,branch:$('crm-branch').value,owner:$('crm-owner-filter').value,month:$('crm-board-month').value,offset:boardOffset});
      const data={items:[],more:false};let next=true;
      while(next){q.set('offset',boardOffset+data.items.length);const page=await api(`/opportunities?${q}`);data.items.push(...page.items);boardProgress.page(boardOffset+data.items.length);next=!!page.more&&page.items.length>0;}

      boardProgress.rendering();
      await new Promise(resolve=>setTimeout(resolve,0));
      dealRows.push(...data.items);renderDealTable();
      for(const item of data.items){
        const card=element('article',undefined,'crm-card');
        if(item.details?.dealName)card.append(element('strong',item.details.dealName));
        links(card,item.links);
        card.append(element('p',[item.branch,item.owner || 'Sin responsable',...item.labels].filter(Boolean).join(' · ')));
        if(item.details?.surgery)card.append(element('p',item.details.surgery));
        if(item.details?.surgeryDate)card.append(element('p',`Cirugía: ${item.details.surgeryDate}`));
        if(item.nextTask)card.append(element('p',`Próxima tarea: ${item.nextTask.title} · ${localDate(item.nextTask.due)}`));
        if(item.overdueTasks)card.append(element('p',`${item.overdueTasks} tareas vencidas`,'crm-overdue'));
        card.append(button('Abrir ficha',()=>openOpportunity(item)),button('Nueva tarea',()=>openTask(null,item)));
        const column=[...$('crm-board').children].find(c=>c.dataset.stage===item.stage);column?.append(card);
      }
      boardOffset+=data.items.length;$('crm-board-more').hidden=!data.more;
      boardBusy=false;
      if(!dealRows.length)renderDealTable();
      boardProgress.complete(boardOffset ? `${boardOffset} DEALS cargados.` : 'Carga completada. No hay DEALS con estos filtros.');
    }catch(e){
      boardProgress.fail(e.message);
      if(!dealRows.length){const cell=$('crm-deals-table')?.querySelector('tbody td');if(cell)cell.textContent='No se pudo completar la carga de DEALS.';}
    }
    finally{boardBusy=false;controls.forEach(id=>{if($(id))$(id).disabled=false;});}
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
          try{await api(`/tasks/${item.id}`,{...item,status:item.status==='done'?'pending':'done'},'PUT');await loadTasks();await loadBoard();}
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
    selectOptions(form.elements.branch,[...new Set([...p.branches,...(saved?.branch?[saved.branch]:[])])],'Sin sede',saved?.branch||'');
    const choices=[...new Set([...p.labels,...(saved?.labels||[])])];
    const field=$('crm-op-labels');field.replaceChildren(element('legend','Etiquetas'));field.hidden=!choices.length;
    for(const value of choices){const label=element('label'),input=document.createElement('input');input.type='checkbox';input.name='labels';input.value=value;input.checked=saved?.labels.includes(value)||false;label.append(input,document.createTextNode(value));field.append(label);}
  }
  function readDealFields(){
    const result={};
    for(const field of config.dealFields || []){
      const value=$('deal-field-'+field.key).value;
      result[field.key]=value===''?null:field.type==='number'?Number(value):value;
    }
    return result;
  }
  let recordItem=null, activityOffset=0, recordTaskOffset=0, activityBusy=false, recordTasksBusy=false, recordGeneration=0;
  function safeLink(label,href){
    const a=element('a',label);a.href=href;if(/^https:/.test(href)){a.target='_blank';a.rel='noopener noreferrer';}return a;
  }
  function phoneNumber(value){let n=String(value||'').replace(/\D/g,'');if(/^9\d{8}$/.test(n))n='56'+n;return /^[1-9]\d{7,14}$/.test(n)?n:null;}
  function fieldLink(key,value){
    if(key==='phone'){const n=phoneNumber(value);return n?safeLink(value,`tel:+${n}`):null;}
    if(key==='email')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value||'')?safeLink(value,`mailto:${encodeURIComponent(value)}`):null;
    if(['medinetUrl','examsUrl'].includes(key)&&value){let u;try{u=new URL(value);}catch{return null;}
      if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
      const ok=key==='medinetUrl'?u.hostname==='clinyco.medinetapp.com'&&/^\/pacientes\/ficha\/(?:\d+\/\d+|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?:\/\d+)?)\/?$/i.test(u.pathname)&&!u.search&&!u.hash:u.hostname==='drive.google.com';
      return ok?safeLink(key==='medinetUrl'?'Abrir ficha Medinet':'Abrir exámenes en Google Drive',u.href):null;
    }return null;
  }
  function propertyValue(field,value){const out=element('div',undefined,'record-value');const a=fieldLink(field.key,value);if(a)out.append(a);else out.textContent=value===null||value===undefined||value===''?'Sin dato':field.key==='value'?new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value):field.type==='date'?String(value).split('-').reverse().join('/'):String(value);return out;}
  function setRecordEditing(edit){const form=$('crm-op-form');form.dataset.editing=String(edit);$('crm-record-edit').textContent=edit?'Ver ficha':'Editar';form.querySelector('[type=submit]').hidden=!edit;}
  function renderDealFields(item,contact){
    const root=$('crm-deal-fields'),side=$('crm-deal-side-fields'),team=$('crm-deal-team-fields');root.replaceChildren();side.replaceChildren();team.replaceChildren();
    const data=item?.details||{},identity=['dealName','idDocument','birthDate','email','phone','city'];
    const order=['dealName','medinetUrl','examsUrl','idDocument','bariatricSurgeon','phone','email','city','coverage','coveragePlan','birthDate','value','weight','height','interest','source'];
    const sorted=[...(config.dealFields||[])].sort((a,b)=>{const x=order.indexOf(a.key),y=order.indexOf(b.key);return (x<0?999:x)-(y<0?999:y);});
    for(const field of sorted){
      const label=element('label',field.label,'record-property'),control=element(field.type==='select'?'select':field.type==='textarea'?'textarea':'input');control.className='record-control';control.id='deal-field-'+field.key;
      if(field.type==='select')selectOptions(control,field.options,'Sin dato');else if(field.type!=='textarea')control.type=field.type;
      if(field.maxLength)control.maxLength=field.maxLength;if(field.type==='number'){control.min=field.min;control.max=field.max;control.step=field.step;}
      control.value=data[field.key]??(field.key==='dealName'?(item?.links?.contact?.text||contact?.contact?.text||''):field.key==='medinetUrl'?(item?.links?.record?.url||contact?.record?.url||''):'');
      label.append(control,propertyValue(field,control.value));if(!control.value)label.classList.add('record-empty');if(field.key==='value')label.classList.add('deal-small-value');
      if(!item&&identity.includes(field.key))root.append(label);else if(field.key==='collaborators'||field.group==='Colaboradores por procedimiento')team.append(label);else side.append(label);
    }
    if(!team.querySelector('.record-property:not(.record-empty)'))team.append(element('p','Sin colaboradores','record-value'));
    $('crm-record-identification').hidden=!!item;$('crm-record-activity').hidden=!item;$('crm-record-new-task').disabled=!item;
    const dl=$('crm-deal-computed');dl.replaceChildren();const add=(label,value)=>dl.append(element('dt',label),element('dd',value||'Sin dato'));
    add('Agregado el',item?.createdAt?localDate(item.createdAt):'Se asigna al guardar');add('Fecha de cambio de fase',item?.stageChangedAt?localDate(item.stageChangedAt):null);add('Fecha de cierre',item?.closedAt?localDate(item.closedAt):null);add('ID del trato',item?.sourceId || item?.id);
    const calculated=element('p',undefined,'crm-calculated');side.append(calculated);const update=()=>{const weight=Number($('deal-field-weight')?.value),height=Number($('deal-field-height')?.value);calculated.textContent=`Edad: ${item?.computed?.age??'Sin dato'} · IMC: ${weight>0&&height>0?(weight/((height/100)**2)).toFixed(1):'Sin dato'}`;};for(const key of ['weight','height'])$('deal-field-'+key)?.addEventListener('input',update);update();
  }
  function renderRecordMeta(item){
    const form=$('crm-op-form'),side=$('crm-deal-side-fields');
    for(const name of ['owner','pipeline','stage','branch']){const select=form.elements[name],label=select.closest('label');label.classList.add('record-property');select.classList.add('record-control');label.querySelector('.record-value')?.remove();label.append(element('div',select.selectedOptions[0]?.textContent||'Sin dato','record-value'));}
    // Keep the same left-hand reading order as the team's former Sell view.
    side.prepend(form.elements.owner.closest('label'));
    const surgeon=$('deal-field-bariatricSurgeon')?.closest('label');let anchor=surgeon||$('deal-field-idDocument')?.closest('label');
    for(const name of ['pipeline','stage','branch']){const label=form.elements[name].closest('label');if(anchor)anchor.after(label);else side.append(label);anchor=label;}
    const tags=$('crm-op-labels');tags.classList.add('record-property');tags.querySelector('.record-value')?.remove();tags.append(element('div',item?.labels?.join(' · ')||'Sin etiquetas','record-value'));$('deal-field-email')?.closest('label')?.after(tags);
  }
  function renderRecordLinks(item,contact){
    const data=item?.details||{},l=item?.links||contact||{};
    $('crm-op-contact').replaceChildren();if(l.contact)links($('crm-op-contact'),{contact:l.contact});
    const conversations=$('crm-record-conversations');conversations.replaceChildren();for(const link of l.conversations||[])links(conversations,{conversations:[link]});if(!conversations.childElementCount)conversations.textContent='Sin conversaciones vinculadas';
    const quick=$('crm-record-contact-links');quick.replaceChildren();for(const key of ['phone','email']){const a=fieldLink(key,data[key]);if(a)quick.append(a);}
    const phone=phoneNumber(data.phone);if(phone)quick.append(safeLink('WhatsApp',`https://wa.me/${phone}`));if(!quick.childElementCount)quick.textContent='Sin teléfono ni correo registrados';
    const docs=$('crm-record-documents');docs.replaceChildren();const medinet=fieldLink('medinetUrl',data.medinetUrl||l.record?.url);const exams=fieldLink('examsUrl',data.examsUrl);if(medinet)docs.append(medinet);if(exams)docs.append(exams);if(!docs.childElementCount)docs.textContent='Sin documentos vinculados';
    const appointments=$('crm-record-appointments');appointments.replaceChildren();const record=fieldLink('medinetUrl',data.medinetUrl||l.record?.url);if(record)appointments.append(record);
  }
  async function loadRecordActivity(more=false){if(!recordItem||activityBusy)return;const id=recordItem.id,generation=recordGeneration;activityBusy=true;$('crm-activity-refresh').disabled=true;const root=$('crm-activity-items');if(!more){activityOffset=0;root.replaceChildren();}try{const data=await api(`/opportunities/${id}/activity?offset=${activityOffset}`);if(generation!==recordGeneration)return;for(const item of data.items){const card=element('article',undefined,'record-event');card.append(element('small',[item.actor||'Equipo Clinyco',localDate(item.at)].join(' · ')),element('h5',item.title));if(item.stage&&item.title==='Cambio de fase')card.append(element('p',config.pipelines.flatMap(p=>p.stages).find(s=>s.id===item.stage)?.name||item.stage));if(item.task)card.append(element('p',item.task));if(item.body){const body=element('div',item.body,'record-note-content');card.append(body);}root.append(card);}activityOffset+=data.items.length;$('crm-activity-more').hidden=!data.more;if(!activityOffset)root.textContent='Sin actividad registrada.';}catch(e){if(generation===recordGeneration)root.textContent='No se pudo cargar la actividad. Intenta actualizar.';}finally{if(generation===recordGeneration){activityBusy=false;$('crm-activity-refresh').disabled=false;}}}
  async function loadRecordTasks(more=false){if(!recordItem||recordTasksBusy)return;const id=recordItem.id,generation=recordGeneration;recordTasksBusy=true;const root=$('crm-record-tasks');if(!more){recordTaskOffset=0;root.replaceChildren();}try{const data=await api(`/tasks?opportunityId=${id}&status=pending&offset=${recordTaskOffset}`);if(generation!==recordGeneration)return;for(const t of data.items){const row=element('div',undefined,'record-task');row.append(button(t.title,()=>openTask(t,recordItem)),element('small',`${localDate(t.due)} · ${t.owner||'Sin responsable'}`),button('Completar',async e=>{e.currentTarget.disabled=true;try{await api(`/tasks/${t.id}`,{...t,status:'done'},'PUT');await loadTasks();await loadBoard();await loadRecordTasks();await loadRecordActivity();}catch(err){$('crm-op-state').textContent=err.message;e.currentTarget.disabled=false;}}));root.append(row);}recordTaskOffset+=data.items.length;$('crm-record-tasks-more').hidden=!data.more;if(!recordTaskOffset)root.textContent='Sin tareas activas';}catch(e){if(generation===recordGeneration)root.textContent='No se pudieron cargar las tareas.';}finally{if(generation===recordGeneration)recordTasksBusy=false;}}
  $('crm-record-edit').onclick=()=>setRecordEditing($('crm-op-form').dataset.editing!=='true');
  $('crm-activity-refresh').onclick=()=>loadRecordActivity();$('crm-activity-more').onclick=()=>loadRecordActivity(true);$('crm-record-tasks-more').onclick=()=>loadRecordTasks(true);
  $('crm-record-new-task').onclick=()=>openTask(null,recordItem);
  $('crm-note-save').onclick=async e=>{const text=$('crm-note-body').value.trim(),id=recordItem?.id,generation=recordGeneration;if(!text){$('crm-note-body').focus();return;}if(!id)return;e.currentTarget.disabled=true;try{await api(`/opportunities/${id}/notes`,{body:text});if(generation===recordGeneration){$('crm-note-body').value='';$('crm-note-state').textContent='Nota guardada';await loadRecordActivity();}}catch(err){if(generation===recordGeneration)$('crm-note-state').textContent=err.message;}finally{e.currentTarget.disabled=false;}};
  function openOpportunity(item=null,contact=null){
    // Restore metadata controls before replacing moved field containers.
    const meta=$('crm-record-meta');for(const name of ['owner','pipeline','stage','branch'])meta.append($('crm-op-form').elements[name].closest('label'));meta.append($('crm-op-labels'));
    activeOpportunity=item;activeContact=contact;recordItem=item;recordGeneration++;activityBusy=false;recordTasksBusy=false;
    const form=$('crm-op-form');form.reset();
    $('crm-op-heading').textContent=item?(item.details?.dealName || item.links?.contact?.text || 'Ficha del DEAL'):'Crear DEAL';$('crm-op-state').textContent='';
    $('crm-op-contact').replaceChildren();links($('crm-op-contact'),item?.links || contact);
    renderDealFields(item,contact);
    selectOptions(form.elements.pipeline,config.pipelines,null,item?.pipeline||$('crm-pipeline').value);form.elements.pipeline.disabled=!!item;
    selectOptions(form.elements.owner,config.owners,'Sin responsable',item?.owner||'');opportunityFields(item);
    renderRecordMeta(item);renderRecordLinks(item,contact);setRecordEditing(!item);$('crm-note-state').textContent='';$('crm-note-body').value='';$('crm-record-tasks').replaceChildren();$('crm-activity-items').replaceChildren();
    $('crm-op-dialog').showModal();if(item){loadRecordActivity();loadRecordTasks();}
  }
  window.crmAddContact=async contact=>{try{await ensureConfig();openOpportunity(null,contact);}catch(e){$('crm-workspace-state').textContent=e.message;}};
  $('crm-op-form').elements.pipeline.onchange=()=>opportunityFields();
  $('crm-op-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,b=form.querySelector('[type=submit]');b.disabled=true;
    try{
      const payload={details:readDealFields(),pipeline:form.elements.pipeline.value,stage:form.elements.stage.value,branch:form.elements.branch.value,owner:form.elements.owner.value,labels:[...form.querySelectorAll('[name=labels]:checked')].map(e=>e.value)};
      if(activeOpportunity)payload.version=activeOpportunity.version;
      else { payload.contactId=new URL(activeContact.contact.url).pathname.split('/').pop(); if(activeContact.sourceConversationId)payload.sourceConversationId=activeContact.sourceConversationId; }
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
      await api(activeTask?`/tasks/${activeTask.id}`:'/tasks',payload,activeTask?'PUT':'POST');$('crm-task-dialog').close();await loadTasks();await loadBoard();if($('crm-op-dialog').open){await loadRecordTasks();await loadRecordActivity();}
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
  const incomingDeal = new URLSearchParams(location.search).get('dealConversation');
  if (/^\d+$/.test(incomingDeal || '')) sessionStorage.setItem('crm-pending-conversation',incomingDeal);
  window.reviewAuthReady?.then(async allowed => {
    if (!allowed) return;
    const id = sessionStorage.getItem('crm-pending-conversation');
    if (!/^\d+$/.test(id || '')) return;
    window.showTab('crm');
    try {
      await ensureConfig();
      const contact = await api(`/conversations/${id}`);
      openOpportunity(null,contact);
      sessionStorage.removeItem('crm-pending-conversation');
      history.replaceState(null,'',location.pathname);
    } catch(e) { $('crm-workspace-state').textContent=e.message; }
  });
  window.loadCrmWorkspace=()=>Promise.all([loadBoard(),loadTasks()]);
})();
