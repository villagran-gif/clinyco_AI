import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('Chatwoot bridge accepts only parent context and forwards only a validated conversation ID', async () => {
  const script=await readFile(new URL('../review/site/chatwoot-deals.js',import.meta.url),'utf8');
  let receive;
  const link={hidden:true,removeAttribute(){delete this.href;}}, status={};
  const parent={postMessage(){}};
  runInNewContext(script,{window:{parent,addEventListener(type,fn){receive=fn;}},document:{getElementById:id=>id==='deal-open'?link:status}});
  const context={event:'appContext',data:{conversation:{id:456,account_id:162472},contact:{name:'PRIVATE_NAME'},currentAgent:{email:'PRIVATE_EMAIL'}}};
  receive({origin:'https://evil.example',source:parent,data:context});
  assert.equal(link.hidden,true);
  receive({origin:'https://app.chatwoot.com',source:{},data:context});
  assert.equal(link.hidden,true);
  receive({origin:'https://app.chatwoot.com',source:parent,data:JSON.stringify(context)});
  assert.equal(link.href,'https://clinyco-ai.netlify.app/?dealConversation=456');
  assert.equal(link.hidden,false);
  assert.doesNotMatch(JSON.stringify(link),/PRIVATE/);
  context.data.conversation.account_id=1;
  receive({origin:'https://app.chatwoot.com',source:parent,data:context});
  assert.equal(link.hidden,true); assert.equal(link.href,undefined);
});
