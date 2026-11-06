const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs');
const {ui,label,character,until}=require('./ui-harness.cjs');
const sse=(content,reasoning='')=>'data:'+JSON.stringify({choices:[{delta:{content,reasoning_content:reasoning},finish_reason:'stop'}]})+'\n\ndata:[DONE]\n\n';

test('official DeepSeek ignores legacy downgrade flags for both explicit thinking on and off',async()=>{
 for(const model of ['deepseek-flash','deepseek-v4-pro','deepseek-v4-flash','deepseek-chat','deepseek-reasoner']){
  const f=fixture(),key='agentfile_nothinking_deepseek_'+model;f.kv.set(key,'1');const p=f.load('src/services/llmProviders.ts'),config={...await p.getLLMConfig(),model};
  for(const thinking of [true,false]){const request=await p.buildChatRequest({config,messages:[],thinking});assert.equal(request.body.thinking.type,thinking?'enabled':'disabled');assert.equal(request.body.reasoning_effort,thinking?'high':undefined);}
  assert.equal(f.kv.get(key),'1');
 }
});
test('official DeepSeek refusal cannot silently retry without the thinking switch',async()=>{
 for(const status of [400,422])for(const thinking of [true,false]){
  let calls=0;const f=fixture({fetch:async()=>{calls++;return new Response('thinking is not supported',{status});}}),p=f.load('src/services/llmProviders.ts');
  await assert.rejects(p.postChat({messages:[{role:'user',content:'测试'}],thinking}),/未改变思考模式/);assert.equal(calls,1);assert.equal(f.kv.has('agentfile_nothinking_deepseek_deepseek-flash'),false);const next=await p.buildChatRequest({messages:[],thinking:true});assert.equal(next.body.thinking.type,'enabled');
 }
});
test('official URL under a custom profile still sends the required switch, while other gateways retain compatibility',async()=>{
 const f=fixture(),p=f.load('src/services/llmProviders.ts'),config={...await p.getLLMConfig(),provider:'custom',baseUrl:'https://api.deepseek.com/v1'};f.kv.set('agentfile_nothinking_custom_deepseek-flash','1');const built=await p.buildChatRequest({config,messages:[],thinking:true});assert.equal(built.body.thinking.type,'enabled');assert.equal(built.body.reasoning_effort,'high');
 const other=await p.buildChatRequest({config:{...config,baseUrl:'https://proxy.invalid/v1'},messages:[],thinking:true});assert.equal(other.body.thinking,undefined);
});
test('format and effort compatibility retries preserve thinking even when the error also mentions thinking',async()=>{
 const bodies=[];const f=fixture({fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body));if(bodies.length===1)return new Response('response_format json_object is unsupported with thinking',{status:400});if(bodies.length===2)return new Response('reasoning_effort not supported with thinking',{status:400});return new Response('{"choices":[{"message":{"content":"ok"}}]}');}}),p=f.load('src/services/llmProviders.ts');const response=await p.postChat({messages:[{role:'user',content:'测试'}],thinking:true,json:true});assert.equal(response.ok,true);assert.equal(bodies.length,3);assert.ok(bodies.every(body=>body.thinking.type==='enabled'));assert.equal(bodies[2].reasoning_effort,undefined);assert.equal(f.kv.has('agentfile_nothinking_deepseek_deepseek-flash'),false);
});
test('real send and regeneration with a stale flag preserve thinking in normal, advanced and hidden-display modes',async()=>{
 const c=character();c.settings.memoryRecall={enabled:false,interval:10};c.settings.conversationMode='light';const bodies=[];const reasoning='接口返回第一段。\n\n接口返回第二段。';const h=ui({mocks:{fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body));return new Response(sse('回复'+bodies.length,reasoning));}}});
 try{h.f.kv.set('@agentsoul_conversations',JSON.stringify([c]));h.f.kv.set('@agentsoul_active','a');h.f.kv.set('agentfile_nothinking_deepseek_deepseek-flash','1');h.f.kv.set('@agentsoul_thinking_mode','off');const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));await until(()=>h.host.tree.props.value.conversations.length&&h.host.tree.props.value.hasApiKey);const api=()=>h.host.tree.props.value;
  await api().sendMessage('普通模式');await api().updateSettings('a',{conversationMode:'advanced'});await api().sendMessage('高级模式');const id=api().conversations[0].messages.at(-1).id;await api().retryMessage(id);assert.equal(bodies.length,3);assert.ok(bodies.every(body=>body.thinking.type==='enabled'&&body.reasoning_effort==='high'));const message=api().conversations[0].messages.at(-1);assert.equal(message.thinking.content,reasoning);assert.equal(message.thinking.kind,'legacy_reasoning');assert.equal(api().thinkingMode,'off');assert.ok(!JSON.stringify(bodies[2].messages).includes(reasoning));
 }finally{h.host.close();}
});
test('absence of reasoning stays authored inner voice, never a fabricated model thought',async()=>{
 const c=character();c.settings.memoryRecall={enabled:false,interval:10};const h=ui({mocks:{fetch:async()=>new Response(sse('你好。〔旁白〕他有些犹豫。〔/旁白〕'))}});
 try{h.f.kv.set('@agentsoul_conversations',JSON.stringify([c]));h.f.kv.set('@agentsoul_active','a');const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));await until(()=>h.host.tree.props.value.conversations.length&&h.host.tree.props.value.hasApiKey);await h.host.tree.props.value.sendMessage('你好');const m=h.host.tree.props.value.conversations[0].messages[1];assert.equal(m.thinking.kind,'character');assert.equal(m.thinking.content,'他有些犹豫。');
 }finally{h.host.close();}
});
test('thought header distinguishes actual returned reasoning from authored asides even when collapsed',()=>{
 for(const kind of ['character','legacy_reasoning',undefined]){const h=ui();try{h.start('components/AgentSoulThinking',{content:'两段也可能是真实接口返回。\n\n不补写。',duration:1,defaultCollapsed:true,thinkingMode:'manual',kind});const text=label(h.host.tree);assert.equal(text.includes('模型思考'),kind==='legacy_reasoning');assert.equal(text.includes('角色旁白'),kind==='character');assert.ok(!text.includes('两段也可能'));}finally{h.host.close();}}
});
