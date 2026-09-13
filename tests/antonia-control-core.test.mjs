import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ControlError, controlKey } from '../conversation/control.js';
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
function inbound({mode='human_active',createdAt='2026-09-13T20:05:00Z',resumedAt=null}={}) {
  const state={system:{aiEnabled:false,humanTakenOver:true,botMessagesSent:0},preevaluation:{awaiting:'age'},melania:{active:true}};
  const messages=[{role:'user',content:'Quiero información sobre conversión'},{role:'assistant',content:'El equipo ya explicó los requisitos.'}];
  let modelInput,history=[],sent=0;
  const control={mode,revision:2,resumed_at:resumedAt,pending:[]};
  const info={appId:'162472',conversationId:'cw:123',userText:'Explícame la recuperación',eventType:'conversation:message',authorType:'user',messageId:'999',sourceType:'chatwoot',rawMessage:{created_at:createdAt}};
  const context={console,process:{env:{}},ControlError,controlKey,MAX_HISTORY_MESSAGES:60,
    extractConversationInfo:()=>info,safeJson:()=>'',antoniaControl:{read:async()=>control,assertActive:async()=>control},
    hydrateConversationCache:async()=>{},getConversationState:()=>state,updateIdentityChannelContext:()=>{},
    persistConversationSnapshot:async()=>{},insertConversationMessage:async x=>messages.push({role:x.role,content:x.content}),
    acquireConversationLock:()=>({ready:Promise.resolve(),release(){}}),
    getConversationRecord:async()=>({state_json:state}),mergeConversationState:(a,b)=>({...a,...b}),
    getRecentCompleteConversationHistory:async()=>messages,conversationHistory:{set:(id,m)=>history=m},
    clearSoftHandoffState:s=>{s.system.aiEnabled=true;s.system.humanTakenOver=false},
    isRecentOutboundEcho:()=>false,resumeSoftHandoffIfAllowed:()=>false,botMessageLimitReached:()=>false,
    claimInboundUserMessage:async x=>{messages.push({role:'user',content:x.content});return true},
    buildOpenAISystemPrompt:()=>'',buildStateSummary:()=>'',getHistory:()=>history,
    askAntoniaAI:async x=>{modelInput=x;return 'La recuperación depende de la evaluación.'},
    guardOpenAiSchedulingClaims:r=>({reply:r}),sendManagedReply:async()=>{sent++;return {ok:true}},
    reviewErrorCode:()=>'',
  };
  const handler=vm.runInNewContext(handlerSource+'\nhandleInboundWebhook',context);
  const response={statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return body}};
  return {state,messages,response,get modelInput(){return modelInput},get sent(){return sent},run:()=>handler({body:{}},response)};
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
