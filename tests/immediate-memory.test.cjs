const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ui,character,until,tick,button,label}=require('./ui-harness.cjs');
const {fixture}=require('./harness.cjs');
const memoryOp={action:'add',kind:'fact',content:'用户喜欢无糖热咖啡',factKey:'user.coffee'};
const reply=operations=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({operations})},finish_reason:'stop'}]}));
function role(enabled=false,n=3){return {...character(),settings:{...character().settings,memoryRecall:{enabled,interval:10}},messages:Array.from({length:n},(_,i)=>[{id:'u'+i,role:'user',content:'我喜欢无糖热咖啡'+i,timestamp:i*2+1},{id:'a'+i,role:'assistant',content:'记下你的偏好'+i,timestamp:i*2+2,inReplyTo:'u'+i}]).flat(),memoryState:{cursors:{a:{throughTimestamp:0,throughIds:[],processed:{}}},editVersion:0,blocked:[]}};}
async function mount(c,handler){let calls=0;const h=ui({mocks:{fetch:async(_url,init)=>{calls++;return handler?handler({f:h.f,body:JSON.parse(init.body),calls}):reply([memoryOp]);}}});h.f.kv.set('@agentsoul_conversations',JSON.stringify([c]));h.f.kv.set('@agentsoul_active','a');const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));h.api=()=>h.host.tree.props.value;h.calls=()=>calls;await until(()=>h.api().activeConversation&&h.api().hasApiKey);return h;}

for(const enabled of [false,true])test('immediate summary works below interval with automatic summary '+(enabled?'on':'off'),async()=>{
 const h=await mount(role(enabled));try{const result=await h.api().recallMemoryNow('a');assert.equal(result.savedCount,1);assert.equal(result.remainingTurns,0);assert.equal(h.calls(),1);const c=h.api().activeConversation;assert.equal(c.settings.memoryRecall.enabled,enabled);assert.equal(c.settings.memoryRecall.interval,10);assert.equal(Object.keys(c.memoryState.cursors.a.processed).length,3);assert.equal(c.memories[0].source.replies.length,3);
 const again=await h.api().recallMemoryNow('a');assert.equal(again.savedCount,0);assert.match(again.note,/没有新增/);assert.equal(h.calls(),1);
 const restarted=await fixture({'@react-native-async-storage/async-storage':h.f.as,'expo-file-system/legacy':h.f.fm}).load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(restarted.conversations[0].memories[0].id,c.memories[0].id);
 }finally{h.host.close();}
});

test('empty summary has truthful feedback and advances only the successfully processed turns',async()=>{
 const h=await mount(role(false,1),()=>reply([]));try{const result=await h.api().recallMemoryNow('a');assert.equal(result.savedCount,0);assert.match(result.note,/没有提取/);assert.equal(h.api().activeConversation.memories.length,0);assert.equal(h.api().activeConversation.memoryState.cursors.a.lastResult,'empty');}finally{h.host.close();}
});

test('failed manual summary keeps progress and permits a successful explicit retry',async()=>{
 let fail=true;const h=await mount(role(),()=>fail?new Response('{}',{status:503}):reply([memoryOp]));try{await assert.rejects(h.api().recallMemoryNow('a'));assert.equal(Object.keys(h.api().activeConversation.memoryState.cursors.a.processed).length,0);assert.equal(h.api().activeConversation.memories.length,0);fail=false;assert.equal((await h.api().recallMemoryNow('a')).savedCount,1);assert.equal(h.calls(),2);}finally{h.host.close();}
});

test('failed manual memory persistence cannot report success or advance the visible cursor',async()=>{
 const h=await mount(role(),({f})=>{f.faults.kv=f.faults.file=true;return reply([memoryOp]);});try{await assert.rejects(h.api().recallMemoryNow('a'));assert.equal(Object.keys(h.api().activeConversation.memoryState.cursors.a.processed).length,0);assert.equal(h.api().activeConversation.memories.length,0);}finally{h.host.close();}
});

test('concurrent manual requests share the role lock and never run duplicate model calls',async()=>{
 let finish;const h=await mount(role(),()=>new Promise(resolve=>{finish=()=>resolve(reply([memoryOp]));}));try{const first=h.api().recallMemoryNow('a');await until(()=>!!finish);await assert.rejects(h.api().recallMemoryNow('a'),/进行中/);assert.equal(h.calls(),1);finish();assert.equal((await first).savedCount,1);}finally{h.host.close();}
});

test('switching the effective reply during manual summary rejects its stale memory',async()=>{
 let finish;const h=await mount(role(),()=>new Promise(resolve=>{finish=()=>resolve(reply([memoryOp]));}));try{const first=Promise.allSettled([h.api().recallMemoryNow('a')]);await until(()=>!!finish);await h.api().editReply('a2','用户选定的新剧情',true);finish();assert.equal((await first)[0].status,'rejected');assert.equal(h.api().activeConversation.memories.length,0);}finally{h.host.close();}
});

test('manual summary respects deleted facts instead of reviving them',async()=>{
 const c=role();c.memoryState.blocked=[{content:memoryOp.content,factKey:memoryOp.factKey}];const h=await mount(c);try{const result=await h.api().recallMemoryNow('a');assert.equal(result.savedCount,0);assert.match(result.note,/删除限制/);assert.equal(h.api().activeConversation.memories.length,0);}finally{h.host.close();}
});

test('immediate button is right aligned, reflects running state and prevents rapid duplicate taps',async()=>{
 const c=role();let calls=0,finish;const h=ui({api:{conversations:[c],recallMemoryNow:async id=>{assert.equal(id,'a');calls++;return new Promise(resolve=>{finish=()=>resolve({savedCount:1,remainingTurns:0});});}}});
 try{h.start('components/MemoryRecallSettings',{conversationId:'a',value:c.settings.memoryRecall,onChange(){}});const b=button(h.host.tree,'立即召回');assert.equal(b.props.style.marginLeft,'auto');const first=b.props.onPress(),second=b.props.onPress();await until(()=>!!finish);assert.equal(calls,1);assert.ok(label(h.host.tree).includes('总结中…'));finish();await Promise.all([first,second]);await tick();assert.ok(h.alerts.some(v=>v[0]==='立即召回'&&v[1].includes('1 条记忆')));assert.ok(button(h.host.tree,'立即召回'));}finally{h.host.close();}
});
