import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ControlError, controlKey } from '../conversation/control.js';
import { runModelBooking } from '../conversation/model-booking.js';
import { conversationContext, parseConversationDecision, applyConversationFacts, recentConversationHistory } from '../conversation/model-conversation.js';
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const sendSource=source.slice(source.indexOf('async function sendManagedReply('),source.indexOf('\nfunction resJsonSkip('));
const handlerSource=source.slice(source.indexOf('const handleInboundWebhook ='),source.indexOf('\nfunction requireChatwootBearer('));
function outbound({audio=false,pauseDuring=''}={}) {
  let active=true, sent=[], history=[];
  const state={system:{aiEnabled:true,botMessagesSent:0}};
  const check=async()=>{if(!active)throw new ControlError('human_control_or_stale_plan')};
  const context={console,ControlError,calculateHumanDelay:()=>0,sleep:async()=>{},getConversationState:()=>state,
    antoniaControl:{assertActive:check,send:async(k,r,kind,fn)=>{await check();const result=await fn();return result}},
    resJsonSkip:reason=>({ok:true,skipped:reason}),isStillLatestUserMessage:()=>true,
    appendAntoniaIntroduction:(s,r)=>r,splitAntoniaReplyBubbles:r=>r.split('[[MSG]]'),
    shouldSuppressOutboundReply:()=>false,ANTONIA_AUDIO_ENABLED:audio,wantsAudioReply:()=>true,
    generateAntoniaAudio:async()=>{if(pauseDuring==='generation')active=false;return new Uint8Array()},
    sendChatwootReply:async()=>{sent.push('intro');if(pauseDuring==='intro')active=false;return {messageId:1}},
    sendChatwootAttachment:async()=>{sent.push('attachment');return {messageId:2}},
    sendConversationReply:async(a,c,text)=>{sent.push(text);if(pauseDuring==='first')active=false;return {messageId:sent.length}},
    addToHistory:(c,r,text)=>history.push(text),rememberOutboundReply:()=>{},maybeSyncPrivateLeadNote:async()=>{},
    botMessageLimitReached:()=>false,persistConversationMessage:async()=>{},saveConversationEvent:async()=>{},persistConversationSnapshot:async()=>{},
  };
  const send=vm.runInNewContext(sendSource+'\nsendManagedReply',context);
  return {sent,history,run:()=>send({conversationId:'cw:123',reply:'first[[MSG]]second',kind:'test',state,info:{transport:'chatwoot',controlKey:['162472','cw:123'],controlRevision:0}})};
}
test('actual sendManagedReply stops between text bubbles and records only the accepted text',async()=>{
  const f=outbound({pauseDuring:'first'}); const result=await f.run();
  assert.deepEqual(f.sent,['first']);assert.deepEqual(f.history,['first']);assert.equal(result.reply,'first');
});
test('actual audio path checks authority after generation and between intro and attachment',async()=>{
  for(const pauseDuring of ['generation','intro']) {
    const f=outbound({audio:true,pauseDuring});assert.match((await f.run()).skipped,/human_control/);
    assert.deepEqual(f.sent,pauseDuring==='generation'?[]:['intro']);assert.deepEqual(f.history,[]);
  }
});
function inbound({mode='human_active',createdAt='2026-09-13T20:05:00Z',resumedAt=null,userText='Explícame la recuperación',decision={action:'conversation',patientSubject:'self',reply:'La recuperación depende de la evaluación.',facts:[]}, booking={}}={}) {
  const state={system:{aiEnabled:false,humanTakenOver:true,botMessagesSent:0},preevaluation:{awaiting:'weight',active:true},melania:{active:true},booking,identity:{savedDataShown:true},contactDraft:{},dealDraft:{}};
  const messages=[{role:'user',content:'Quiero información sobre conversión'},{role:'assistant',content:'El equipo ya explicó los requisitos.'}];
  let modelInput,history=[],sent=0,searches=0,changes=[];
  const control={mode,revision:2,resumed_at:resumedAt,pending:[]};
  const info={appId:'162472',conversationId:'cw:123',userText,eventType:'conversation:message',authorType:'user',messageId:'999',sourceType:'chatwoot',rawMessage:{created_at:createdAt}};
  const context={console,process:{env:{}},ControlError,controlKey,MAX_HISTORY_MESSAGES:60,
    conversationContext,parseConversationDecision,applyConversationFacts,recentConversationHistory,dbEnabled:()=>true,calculateLeadScore:()=>0,
    runModelBooking,requestedExam:()=>null,examFollowup:()=>false,isEndoscopyBooking:()=>false,upsertConversationState:async()=>{},
    runMedinetAntonia:async()=>{searches++;return {available_slots:[],patient_reply:'No hay cupos publicados'}},
    extractConversationInfo:()=>info,safeJson:()=>'',antoniaControl:{read:async()=>control,assertActive:async()=>control,change:async(k,v)=>{changes.push(v);return control}},
    hydrateConversationCache:async()=>{},getConversationState:()=>state,updateIdentityChannelContext:()=>{},
    persistConversationSnapshot:async()=>{},insertConversationMessage:async x=>messages.push({role:x.role,content:x.content}),
    acquireConversationLock:()=>({ready:Promise.resolve(),release(){}}),
    getConversationRecord:async()=>({state_json:state}),mergeConversationState:(a,b)=>({...a,...b}),
    getRecentCompleteConversationHistory:async()=>messages,conversationHistory:{set:(id,m)=>history=m},
    clearSoftHandoffState:s=>{s.system.aiEnabled=true;s.system.humanTakenOver=false},
    isRecentOutboundEcho:()=>false,resumeSoftHandoffIfAllowed:()=>false,botMessageLimitReached:()=>false,
    claimInboundUserMessage:async x=>{messages.push({role:'user',content:x.content});return true},
    buildOpenAISystemPrompt:()=>'',buildStateSummary:()=>'',getHistory:()=>history,
    askAntoniaAI:async x=>{modelInput=x;return typeof decision === 'string' ? decision : JSON.stringify(decision)},
    guardOpenAiSchedulingClaims:r=>({reply:r}),sendManagedReply:async args=>{sent++;return {ok:true,reply:args.reply}},
    reviewErrorCode:()=>'',
  };
  const handler=vm.runInNewContext(handlerSource+'\nhandleInboundWebhook',context);
  const response={statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return body}};
  return {state,messages,response,get modelInput(){return modelInput},get sent(){return sent},get searches(){return searches},changes,run:()=>handler({body:{}},response)};
}
test('R11: actual inbound persists a patient message during pause without calling the model',async()=>{
  const f=inbound();await f.run();assert.equal(f.response.body.skipped,'human_control');
  assert.equal(f.messages.at(-1).content,'Explícame la recuperación');assert.equal(f.modelInput,undefined);
});
test('R25: actual resumed turn loads paused history, clears old interaction and answers only current request',async()=>{
  const f=inbound({mode:'bot_active',resumedAt:'2026-09-13T20:00:00Z'});await f.run();
  assert.equal(f.response.statusCode,200);assert.equal(f.sent,1);
  assert.equal(f.modelInput.history.length,3);assert.equal(f.modelInput.history.at(-1).content,'Explícame la recuperación');
  assert.equal(f.state.preevaluation.awaiting,null);assert.equal(f.state.melania.active,false);
  assert.equal(f.state.system.resumeContextPending,false);
});
test('R25: old patient turn dispatched after resume is preserved without replay',async()=>{
  const f=inbound({mode:'bot_active',createdAt:'2026-09-13T19:00:00Z',resumedAt:'2026-09-13T20:00:00Z'});await f.run();
  assert.equal(f.response.body.skipped,'before_explicit_resume');assert.equal(f.sent,0);assert.equal(f.modelInput,undefined);
});

for (const userText of ['Mi hija como 80', 'Kilos', '&0', 'Quiero que me expliques cómo funciona', '¿Atienden Fonasa?']) {
  test(`retired questionnaires cannot preempt the model: ${userText}`, async () => {
    const f=inbound({mode:'bot_active',userText});
    f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
    await f.run();
    assert.equal(f.response.statusCode,200);assert.equal(f.sent,1);
    assert.equal(f.modelInput.history.at(-1).content,userText);
    assert.equal(f.modelInput.structured,true);
  });
}
test('invalid model JSON fails closed without sending a canned questionnaire',async()=>{
  const f=inbound({mode:'bot_active',decision:'not-json'});
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.response.statusCode,500);assert.equal(f.sent,0);
});
test('information during slot confirmation bypasses transactional booking and preserves pending slot',async()=>{
  const f=inbound({mode:'bot_active',userText:'Antes explícame el procedimiento',booking:{awaitingConfirmation:true,chosenSlot:{id:'synthetic'}}});
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.response.statusCode,200);assert.equal(f.sent,1);
  assert.equal(f.state.booking.chosenSlot.id,'synthetic');
});

test('actual handler routes a model booking search to published search without a legacy menu',async()=>{
  const f=inbound({mode:'bot_active',userText:'Busco hora de nutrición',decision:{action:'booking',patientSubject:'self',reply:'Consulta',facts:[],booking:{operation:'search',query:'nutrición'}}});
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.response.statusCode,200);assert.equal(f.searches,1);assert.equal(f.sent,1);
  assert.equal(f.response.body.reply,'No hay cupos publicados');
});
test('actual handler persists human request instead of merely muting a cached snapshot',async()=>{
  const f=inbound({mode:'bot_active',userText:'Quiero hablar con una persona',decision:{action:'human_request',patientSubject:'self',reply:'Queda pendiente atención humana.',facts:[]}});
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.response.statusCode,200);assert.equal(f.changes.length,1);
  assert.equal(f.changes[0].mode,'human_active');assert.equal(f.changes[0].expectedRevision,2);
});

for (const patientSubject of ['unknown','other']) {
  test(`published search executes for ${patientSubject} without sending a model promise`,async()=>{
    const f=inbound({mode:'bot_active',userText:'Busco cupos de nutrición en Santiago',
      decision:{action:'booking',patientSubject,reply:'Déjame revisar los cupos disponibles',facts:[],booking:{operation:'search',query:'nutrición'}}});
    f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
    await f.run();assert.equal(f.response.statusCode,200);assert.equal(f.searches,1);
    assert.equal(f.response.body.reply,'No hay cupos publicados');
  });
  test(`automatic reservation remains blocked for ${patientSubject}`,async()=>{
    const f=inbound({mode:'bot_active',userText:'Sí',
      booking:{modelConfirmation:{presented:true},chosenSlot:{id:'synthetic'}},
      decision:{action:'booking',patientSubject,reply:'Reserva confirmada',facts:[],booking:{operation:'confirm'}}});
    f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
    await f.run();assert.equal(f.response.statusCode,200);assert.equal(f.searches,0);
    assert.doesNotMatch(f.response.body.reply,/Reserva confirmada/);
    assert.equal(f.state.booking.modelConfirmation,null);
  });
}
test('clear data is persisted without adding a mandatory confirmation step',async()=>{
  const f=inbound({mode:'bot_active',userText:'Peso 82 kg',decision:{action:'conversation',patientSubject:'self',reply:'¿Cuánto mides?',facts:[{field:'weightKg',value:82,subject:'self',evidence:'82 kg'}]}});
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.state.conversation.facts[0].value,82);
  assert.equal(f.response.body.reply,'¿Cuánto mides?');assert.equal(f.searches,0);
});
test('ambiguous datum preserves known facts and delivers only the proposed clarification',async()=>{
  const f=inbound({mode:'bot_active',userText:'&0',decision:{action:'conversation',patientSubject:'self',reply:'¿Qué peso quisiste escribir?',facts:[]}});
  f.state.conversation={facts:[{field:'weightKg',value:80,subject:'self'}]};
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.state.conversation.facts[0].value,80);
  assert.equal(f.response.body.reply,'¿Qué peso quisiste escribir?');assert.equal(f.searches,0);
});
test('intervening informational question invalidates consent so a later yes cannot authorize old proposal',async()=>{
  const chosenSlot={source:'agendaweb',date:'20/09/2026',time:'10:00',professional:'Sintético',branchName:'Santiago'};
  const f=inbound({mode:'bot_active',userText:'¿Cuánto cuesta?',booking:{chosenSlot,modelConfirmation:{presented:true}},
    decision:{action:'conversation',patientSubject:'self',reply:'¿Quieres información del procedimiento?',facts:[]}});
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.state.booking.modelConfirmation,null);assert.equal(f.state.booking.chosenSlot,chosenSlot);
  f.state.conversation={facts:[{field:'rut',value:'12.345.678-5',subject:'self'},{field:'email',value:'test@example.test',subject:'self'},{field:'phone',value:'+56911111111',subject:'self'}]};
  let posts=0;
  const reply=await runModelBooking({state:f.state,plan:{operation:'confirm'},userText:'Sí',messageId:'1000',persist:async()=>{},assertActive:async()=>{},reserve:async()=>{posts++}});
  assert.equal(posts,0);assert.match(reply,/Reserva por confirmar/);
});
test('clear conversational correction invalidates the old proposal without asking to reconfirm the datum',async()=>{
  const f=inbound({mode:'bot_active',userText:'Corrijo: viajaré a Antofagasta',booking:{modelConfirmation:{presented:true}},
    decision:{action:'conversation',patientSubject:'self',reply:'¿Qué fecha te acomoda?',facts:[{field:'careDestination',value:'Antofagasta',subject:'self',evidence:'viajaré a Antofagasta'}]}});
  f.state.system.aiEnabled=true;f.state.system.humanTakenOver=false;
  await f.run();assert.equal(f.state.booking.modelConfirmation,null);
  assert.equal(f.state.conversation.facts[0].value,'Antofagasta');assert.equal(f.response.body.reply,'¿Qué fecha te acomoda?');
});
const guardSource=source.slice(source.indexOf('function guardOpenAiSchedulingClaims('),source.indexOf('\nfunction appendAntoniaIntroduction('));
const realGuard=vm.runInNewContext(guardSource+'\nguardOpenAiSchedulingClaims',{normalizeKey:s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()});
test('conversational text cannot announce an unexecuted availability search',()=>{
  for(const text of ['Déjame revisar los cupos disponibles','Voy a consultar la agenda','Estoy buscando horarios','Perfecto[[MSG]]Déjame revisar los cupos disponibles']) {
    assert.equal(realGuard(text,{}).reply,'No tengo un resultado de disponibilidad para esa solicitud.');
  }
  assert.equal(realGuard('¿En qué sede buscas la hora?',{}).reply,'¿En qué sede buscas la hora?');
  assert.equal(realGuard('No estoy buscando cupos todavía.',{}).reply,'No estoy buscando cupos todavía.');
});
