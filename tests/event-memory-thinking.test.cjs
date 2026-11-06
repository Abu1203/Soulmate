const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs');
const {ui,nodes,label,character,tick,until}=require('./ui-harness.cjs');
const user=(id,content='你好',timestamp=1)=>({id,role:'user',content,timestamp});
const reply=(id,inReplyTo,content='回应',timestamp=2)=>({id,role:'assistant',content,inReplyTo,timestamp});
const memory=(id,content,more={})=>({id,content,tags:[],weight:80,isFlashbulb:false,timestamp:1,...more});
const event='上周末用户因工作受挫独自在海边散步，角色赶来陪伴。用户说明自己害怕重要的人突然失联，角色认真解释了当天临时离开的原因并道歉。双方一起看完日落，约定今后不能赴约时提前告知，遇到压力时先坦诚说明而非消失。用户接受道歉，关系从试探转为更愿意表达真实需要；下周日晚仍约在同一片海滩见面。';
const operations=[{action:'add',kind:'relationship',content:event}];
const response=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({operations})},finish_reason:'stop'}]}));
const sse=(content,reasoning='',finish_reason='stop')=>'data:'+JSON.stringify({choices:[{delta:{content,reasoning_content:reasoning},finish_reason}]})+'\n\ndata:[DONE]\n\n';
async function mount(c,fetch){const h=ui({mocks:{fetch}});h.f.kv.set('@agentsoul_conversations',JSON.stringify([c]));h.f.kv.set('@agentsoul_active','a');const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));await until(()=>h.host.tree.props.value.conversations.length&&h.host.tree.props.value.hasApiKey);h.api=()=>h.host.tree.props.value;return h;}

test('complete event memory retains cause, outcome and agreement through saving, restart and recall',async()=>{
 const c=character(),f=fixture();c.settings.memoryRecall={enabled:true,interval:1};c.memoryState=f.load('src/services/memorySummary.ts').initialMemoryState([],'a');const bodies=[];
 const h=await mount(c,async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return body.response_format?response():new Response(sse('下周见。'));});
 try{await h.api().sendMessage('记住我们这次海边约定。'+event);await until(()=>h.api().conversations[0].memories.length===1);const saved=h.api().conversations[0];assert.ok(event.length>60);assert.equal(saved.memories[0].content,event);assert.equal(saved.memories[0].core,true);
  await h.api().updateSettings('a',{memoryRecall:{enabled:false,interval:1}});await h.api().sendMessage('早安');const prompt=bodies.filter(b=>b.stream).at(-1).messages[0].content;assert.ok(prompt.includes(event));assert.ok(prompt.includes('下周日晚'));assert.ok(prompt.includes('提前告知'));
  const fresh=fixture({'@react-native-async-storage/async-storage':h.f.as,'expo-file-system/legacy':h.f.fm});const restored=(await fresh.load('src/services/agentsoulStorage.ts').loadConversations()).conversations[0];assert.equal(restored.memories[0].content,event);assert.equal(fresh.load('src/services/storyEngine.ts').activeMemories(restored)[0].content,event);
 }finally{h.host.close();}
});
test('long core memories have a shared capacity budget without deleting other event records',()=>{
 const f=fixture(),recall=f.load('src/services/memoryEngine.ts').recallMemories,p=f.load('src/services/memoryPolicy.ts');const pool=Array.from({length:10},(_,i)=>memory('m'+i,event+'当事人'+i,{kind:'relationship',core:true,timestamp:i+1}));const found=recall('早安',pool,12,'a');assert.ok(found.length>0&&found.length<=p.CORE_MEMORY_MAX_ITEMS);assert.ok(found.reduce((n,m)=>n+p.memoryCharCount(m.content),0)<=1200);assert.ok(found.every(m=>m.content===pool.find(old=>old.id===m.id).content));assert.equal(pool.length,10);
});
test('a detailed shared event mentioning a city does not replace or hide a separate city fact',()=>{
 const f=fixture(),summary=f.load('src/services/memorySummary.ts');const fact=memory('city','用户住在杭州',{kind:'fact',factKey:'user.home_city'});const content='用户搬到杭州后与角色共度搬家的第一晚。'+event;const saved=summary.applyMemoryOperations([fact],[{action:'add',content,kind:'relationship'}],{cursors:{},editVersion:0,blocked:[]},{characterId:'a',conversationId:'a',scene:'private',messageIds:[]},[]);assert.equal(saved.length,2);assert.equal(saved.find(m=>m.id==='city').content,fact.content);const recalled=f.load('src/services/memoryEngine.ts').recallMemories('我住哪里',saved,12,'a');assert.ok(recalled.some(m=>m.id==='city'));assert.ok(recalled.some(m=>m.content===content));
});
test('a full event can be edited and kept as core; excessive edits fail without losing the original',async()=>{
 const c=character();c.settings.memoryRecall={enabled:false,interval:10};c.memories=[memory('event',event,{kind:'relationship',core:true})];const h=await mount(c,async()=>response());try{const revised=event+'双方再次确认这个约定。';await h.api().editMemory('a','event',revised);assert.equal(h.api().conversations[0].memories[0].content,revised);await assert.rejects(h.api().editMemory('a','event','字'.repeat(301)),/300/);assert.equal(h.api().conversations[0].memories[0].content,revised);await h.api().setCoreMemory('a','event',false);await h.api().setCoreMemory('a','event',true);assert.equal(h.api().conversations[0].memories[0].core,true);}finally{h.host.close();}
});
test('detailed event follows its selected reply version instead of leaking from an archived plot',()=>{
 const f=fixture(),s=f.load('src/services/storyEngine.ts');let c=character();c.messages=[user('u'),reply('r','u')];c=s.hydrateStory(c);const original=s.selectedVersion(c.messages[1]).id;c.memories=[memory('event',event,{kind:'relationship',core:true,source:{characterId:'a',conversationId:'a',scene:'private',messageIds:['u','r'],replies:[{messageId:'r',versionId:original}]}})];c=s.changeReply(c,'r',{content:'角色拒绝作出约定。',origin:'edit'});assert.equal(s.activeMemories(c).length,0);c=s.changeReply(c,'r',{versionId:original});assert.equal(s.activeMemories(c)[0].content,event);
});
test('DeepSeek chat explicitly enables high reasoning and expands its total output allowance only',async()=>{
 const f=fixture(),p=f.load('src/services/llmProviders.ts'),request=await f.load('src/services/SoulService.ts').buildCharacterRequest({character:character(),history:[],query:'继续'});const built=await p.buildChatRequest(request);assert.equal(built.body.max_tokens,16384);assert.equal(built.body.thinking.type,'enabled');assert.equal(built.body.reasoning_effort,'high');assert.equal(request.timeoutMs,180000);
 const summary=await p.buildChatRequest({...request,stream:false,thinking:false,json:true,maxTokens:8192});assert.equal(summary.body.thinking.type,'disabled');assert.equal(summary.body.reasoning_effort,undefined);assert.equal(summary.body.max_tokens,8192);
});
test('long reasoning is received, persisted and displayed in full without entering future role context',async()=>{
 const c=character();c.settings.memoryRecall={enabled:false,interval:10};const reasoning='接口返回的完整思考段落。'.repeat(1500);let calls=0,lastBody;
 const h=await mount(c,async(_url,init)=>{lastBody=JSON.parse(init.body);return new Response(sse('正常角色回复。',++calls===1?reasoning:'下一轮思考'));});
 try{await h.api().sendMessage('继续');const saved=h.api().conversations[0].messages[1];assert.equal(saved.thinking.content,reasoning);assert.equal(saved.thinking.kind,'legacy_reasoning');const stored=JSON.parse(JSON.parse(h.f.kv.get('@soulmate_conversations_commit_v1')).payload)[0];assert.equal(stored.messages[1].thinking.content,reasoning);
  const view=ui();try{view.start('components/AgentSoulMessageBubble',{message:saved});const thinking=nodes(view.host.tree,n=>n.type==='AgentSoulThinking')[0];assert.equal(thinking.props.content,reasoning);assert.equal(thinking.props.kind,'legacy_reasoning');}finally{view.host.close();}
  await h.api().sendMessage('下一轮');assert.ok(!JSON.stringify(lastBody.messages).includes('接口返回的完整思考段落'));
 }finally{h.host.close();}
});
test('expanded thinking has no line limit, and authored inner voice is identified without replacing its text',()=>{
 const full='完整内容'.repeat(500);for(const kind of ['character','legacy_reasoning']){const h=ui();try{h.start('components/AgentSoulThinking',{content:full,duration:1,defaultCollapsed:false,isStreaming:false,thinkingMode:'auto',kind});assert.ok(label(h.host.tree).includes(full));assert.equal(label(h.host.tree).includes('角色内心描写'),kind==='character');const body=nodes(h.host.tree,n=>n.type==='Text'&&label(n)===full)[0];assert.equal(body.props.numberOfLines,undefined);}finally{h.host.close();}}
});
test('unsupported reasoning-effort falls back without disabling the actual thinking channel',async()=>{
 const bodies=[];const f=fixture({fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body));return bodies.length===1?new Response('reasoning_effort is not supported',{status:400}):new Response(sse('正常回复','模型思考'));}});const p=f.load('src/services/llmProviders.ts'),config=await p.getLLMConfig();const res=await p.postChat({config,messages:[{role:'user',content:'继续'}],thinking:true,stream:false});assert.equal(res.ok,true);assert.equal(bodies.length,2);assert.equal(bodies[1].reasoning_effort,undefined);assert.equal(bodies[1].thinking.type,'enabled');const next=await p.buildChatRequest({config,messages:[],thinking:true});assert.equal(next.body.thinking.type,'enabled');
});
test('max_tokens truncation keeps received thinking and flags the reply without summarizing it',async()=>{
 const c=character();c.settings.memoryRecall={enabled:true,interval:1};let calls=0;const h=await mount(c,async()=>{calls++;return new Response(sse('未完的回复','已接收的思考','max_tokens'));});try{await h.api().sendMessage('继续');const m=h.api().conversations[0].messages[1];assert.ok(m.error.includes('长度限制'));assert.equal(m.thinking.content,'已接收的思考');assert.equal(calls,1);assert.equal(h.api().conversations[0].memories.length,0);}finally{h.host.close();}
});
test('larger saved memories still fit a small endpoint alongside a complete recent exchange',async()=>{
 const f=fixture();f.kv.set('agentfile_provider','custom');f.kv.set('agentfile_provider_migrated_v1','1');f.kv.set('agentfile_custom_provider',JSON.stringify({name:'测试接口',baseUrl:'https://invalid.example',model:'test',contextWindow:8192}));
 const c=character();c.memories=Array.from({length:15},(_,i)=>memory('m'+i,event+i,{kind:'relationship',core:true,timestamp:i+1}));const request=await f.load('src/services/SoulService.ts').buildCharacterRequest({character:c,history:[user('u'),reply('r','u')],query:'早安'});const estimate=f.load('src/services/conversationContext.ts').estimateTokens;assert.ok(request.messages.reduce((n,m)=>n+estimate(m.content),0)+request.maxTokens+512<=8192);assert.ok(request.messages[0].content.includes('下周日晚'));assert.equal(request.messages.length,4);assert.equal(c.memories.length,15);
});
