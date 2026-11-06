const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs');
const {ui,nodes,label,character,tick,until}=require('./ui-harness.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const user=(id,content='你好',timestamp=1)=>({id,role:'user',content,timestamp});
const reply=(id,inReplyTo,content='回应。第二句。',more={})=>({id,role:'assistant',content,inReplyTo,timestamp:2,...more});
const memory=(id,content,extra={})=>({id,content,tags:[],weight:80,isFlashbulb:false,timestamp:1,...extra});
const rounds=n=>Array.from({length:n},(_,i)=>[user('u'+i,'第'+i+'轮普通聊天',i*2+1),reply('r'+i,'u'+i,'收到。',{timestamp:i*2+2})]).flat();
const sse=content=>'data:'+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata:[DONE]\n\n';
const result=operations=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({operations})},finish_reason:'stop'}]}));
const coffee=[{action:'add',kind:'fact',content:'用户喜欢无糖热咖啡',factKey:'user.preference.coffee'}];
const config={provider:'deepseek',model:'deepseek-flash',apiKey:'TEST-ONLY',baseUrl:'https://invalid.example',caps:{thinkingParam:'thinking',maxTokensCap:8192,maxTokensField:'max_tokens',vision:false}};
async function mount(c,fetch){const h=ui({mocks:{fetch}});h.f.kv.set('@agentsoul_conversations',JSON.stringify([c]));h.f.kv.set('@agentsoul_active',c.id);const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));await until(()=>h.host.tree.props.value.conversations.length&&h.host.tree.props.value.hasApiKey);h.api=()=>h.host.tree.props.value;return h;}
function seeded(n=0){const c=character();c.settings.memoryRecall={enabled:true,interval:10};c.messages=rounds(n);c.memoryState=fixture().load('src/services/memorySummary.ts').initialMemoryState([],'a');return c;}

test('private display keeps each reply mode when the current switch changes',async()=>{
 const c=character();c.settings.splitMessages=false;c.messages=[user('u'),reply('whole','u','整段一。整段二。',{splitMessages:false}),user('u2'),reply('split','u2','分句一。分句二。',{splitMessages:true})];
 const h=ui({api:{activeConversation:c}});try{h.start('screens/AgentSoulChatScreen');const data=()=>nodes(h.host.tree,n=>n.type==='FlatList')[0].props.data;assert.deepEqual(Array.from(data().filter(m=>m.role==='assistant'),m=>m.bodyText),['分句二。','分句一。','整段一。整段二。']);c.settings.splitMessages=true;h.host.render();assert.deepEqual(Array.from(data().filter(m=>m.role==='assistant'),m=>m.bodyText),['分句二。','分句一。','整段一。整段二。']);assert.equal(c.messages.length,4);}finally{h.host.close();}
});
test('legacy whole replies stay whole while original split records remain recognizable',()=>{
 const f=fixture(),story=f.load('src/services/storyEngine.ts'),view=f.load('src/services/replyPresentation.ts');const c=character();c.messages=[user('u'),reply('old','u')];assert.equal(view.usesSplitPresentation(story.hydrateStory(c).messages[1]),false);c.messages.push(reply('tail','u','原来的第二条。'));const merged=story.hydrateStory(c).messages[1];assert.equal(merged.legacyParts.length,2);assert.equal(view.usesSplitPresentation(merged),true);
});
test('sentence segmentation retains brackets, quotes, punctuation groups and decimal numbers',()=>{
 const split=fixture().load('src/services/replyPresentation.ts').sentenceSegments;
 assert.deepEqual(plain(split('（停顿。微笑）你好。你说“真的吗？”数值3.14。最后一句')),['（停顿。微笑）你好。','你说“真的吗？”','数值3.14。','最后一句']);assert.deepEqual(plain(split('好啊！！再见……')),['好啊！！','再见……']);assert.deepEqual(plain(split('Price 3.14. Next.')),['Price 3.14.','Next.']);
});
test('editing preserves the selected presentation; regeneration and branch recovery retain their own modes',()=>{
 const f=fixture(),story=f.load('src/services/storyEngine.ts');let c=character();c.messages=[user('u'),reply('r','u','旧回复。第二句。',{splitMessages:true})];c=story.hydrateStory(c);const original=story.selectedVersion(c.messages[1]).id;
 c=story.changeReply(c,'r',{content:'手动一。手动二。',origin:'edit'});assert.equal(story.selectedVersion(c.messages[1]).splitMessages,true);
 c=story.changeReply(c,'r',{content:'新整段。一并显示。',origin:'model',splitMessages:false});assert.equal(story.selectedVersion(c.messages[1]).splitMessages,false);
 c=story.changeReply(c,'r',{versionId:original});assert.equal(story.selectedVersion(c.messages[1]).splitMessages,true);assert.equal(story.selectedVersion(c.messages[1]).content,'旧回复。第二句。');assert.equal(f.load('src/services/dataValidation.ts').validConversations([c]),true);
});
test('private sends persist mode at request start and restart restores it',async()=>{
 const c=seeded();c.settings.memoryRecall.enabled=false;c.settings.splitMessages=true;let finish,calls=0;const h=await mount(c,async()=>++calls===1?new Promise(r=>finish=()=>r(new Response(sse('第一句。第二句。')))):new Response(sse('下一轮整段。第二句。')));
 try{const sending=h.api().sendMessage('继续');await until(()=>!!finish);await h.api().updateSettings('a',{splitMessages:false});finish();await sending;assert.equal(h.api().conversations[0].messages[1].splitMessages,true);await h.api().sendMessage('下一轮');assert.equal(h.api().conversations[0].messages[3].splitMessages,false);const fresh=fixture({'@react-native-async-storage/async-storage':h.f.as,'expo-file-system/legacy':h.f.fm});const restored=(await fresh.load('src/services/agentsoulStorage.ts').loadConversations()).conversations[0];assert.equal(restored.messages[1].splitMessages,true);assert.equal(restored.messages[3].splitMessages,false);}
 finally{h.host.close();}
});
test('group history also keeps reply-specific presentation across toggles',async()=>{
 const a=character(),g={...character('g'),type:'group',memberIds:['a'],settings:{...a.settings,splitMessages:true}};
 const h=ui({api:{conversations:[a,g],activeConversation:a}});try{h.f.kv.set('@soulmate_group_msgs_g',JSON.stringify([user('u'),reply('a1','u','旧整段。不要拆。',{senderId:'a',splitMessages:false}),user('u2'),reply('a2','u2','新分句。保持分句。',{senderId:'a',splitMessages:true})]));h.start('screens/GroupChatScreen',{route:{params:{convId:'g'}}});await until(()=>nodes(h.host.tree,n=>n.type==='FlatList')[0]?.props.data.length===5);g.settings.splitMessages=false;h.host.render();assert.deepEqual(Array.from(nodes(h.host.tree,n=>n.type==='FlatList')[0].props.data.filter(m=>m.role==='assistant'),m=>m.content),['旧整段。不要拆。','新分句。','保持分句。']);}finally{h.host.close();}
});
test('ninth to tenth complete round generates durable memory and injects it before the next chat',async()=>{
 const bodies=[];const h=await mount(seeded(9),async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return body.response_format?result(coffee):new Response(sse('记住了。'));});
 try{await until(()=>!Object.keys(h.api().conversations[0].memoryState.jobs||{}).length);assert.equal(bodies.length,0);await h.api().sendMessage('我喜欢无糖热咖啡');await until(()=>h.api().conversations[0].memories.length===1);const c=h.api().conversations[0];assert.equal(Object.keys(c.memoryState.cursors.a.processed).length,10);assert.equal(c.memoryState.cursors.a.lastResult,'saved');assert.equal(bodies.filter(b=>b.response_format).length,1);
  const stored=JSON.parse(JSON.parse(h.f.kv.get('@soulmate_conversations_commit_v1')).payload)[0];assert.equal(stored.memories[0].content,coffee[0].content);await h.api().sendMessage('那你还记得吗？');assert.ok(bodies.filter(b=>b.stream).at(-1).messages[0].content.includes(coffee[0].content));const fresh=fixture({'@react-native-async-storage/async-storage':h.f.as,'expo-file-system/legacy':h.f.fm});assert.equal((await fresh.load('src/services/agentsoulStorage.ts').loadConversations()).conversations[0].memories.length,1);
 }finally{h.host.close();}
});
test('a valid empty summary is distinguishable from saving memory or a failed job',async()=>{
 const h=await mount(seeded(10),async()=>new Response(JSON.stringify({choices:[{message:{content:'{"operations":[],"emptyReason":"只有日常问候，没有新增长期事实"}'}}]})));
 try{await until(()=>h.api().conversations[0].memoryState.cursors.a.lastResult==='empty');const c=h.api().conversations[0];assert.equal(c.memories.length,0);assert.equal(Object.keys(c.memoryState.cursors.a.processed).length,10);assert.ok(c.memoryState.cursors.a.lastResultNote.includes('日常问候'));assert.equal(c.memoryState.cursors.a.lastSavedCount,0);}finally{h.host.close();}
});
test('invalid update references cannot silently consume the batch with zero saved memories',async()=>{
 const h=await mount(seeded(10),async()=>result([{action:'update',id:'invented-id',kind:'fact',content:'用户喜欢无糖热咖啡'}]));try{await until(()=>h.api().conversations[0].memoryState.jobs?.a?.attempts===1);const c=h.api().conversations[0];assert.equal(Object.keys(c.memoryState.cursors.a.processed).length,0);assert.ok(c.memoryState.jobs.a.lastError.includes('记忆ID'));assert.equal(c.memories.length,0);}finally{h.host.close();}
});
test('missing legacy trigger at the failure cap does not disable automatic summary forever',async()=>{
 const c=seeded(10);c.memoryState.jobs={a:{scene:'private',attempts:5,retryAt:0,lastError:'旧版失败'}};let calls=0;
 const h=await mount(c,async()=>{calls++;return result(coffee);});try{await until(()=>h.api().conversations[0].memories.length===1);await h.api().summarizeConversation('a');assert.equal(calls,1);}finally{h.host.close();}
});
test('a capped job in another scene cannot conceal a missing private summary after restart',async()=>{
 const c=seeded(10);c.memoryState.cursors['moments:a']={throughTimestamp:0,throughIds:[],processed:{}};c.memoryState.jobs={'moments:a':{scene:'moments',attempts:5,retryAt:0,lastError:'旧朋友圈失败'}};let calls=0;
 const h=await mount(c,async()=>{calls++;return result(coffee);});try{await until(()=>h.api().conversations[0].memories.length===1);assert.equal(calls,1);assert.equal(h.api().conversations[0].memoryState.jobs['moments:a'].attempts,5);}finally{h.host.close();}
});
test('summary accepts longer complete events within its budget and handles empty arrays',()=>{
 const s=fixture().load('src/services/memorySummary.ts');assert.equal(s.validateOperations({operations:[{action:'add',content:'字'.repeat(26),kind:'fact'}]}).length,1);assert.throws(()=>s.validateOperations({operations:[{action:'add',content:'字'.repeat(301),kind:'fact'}]}));assert.throws(()=>s.validateOperations({operations:coffee.concat(coffee,coffee,coffee)}));assert.deepEqual(plain(s.parseSummaryOperations('```json\n[]\n```')),[]);assert.throws(()=>s.parseSummaryOperations('接口出错'),/格式异常/);
});
test('summary reserves output for reasoning models without adding a verification request',async()=>{
 let body,calls=0;const f=fixture({fetch:async(_url,init)=>{body=JSON.parse(init.body);calls++;return result(coffee);}});const s=f.load('src/services/memorySummary.ts');const r=await s.summarizeNewTurns([{user:user('u','我喜欢无糖热咖啡'),assistants:[reply('r','u')]}],[],undefined,config);
 assert.equal(calls,1);assert.equal(body.max_tokens,8192);assert.equal(body.thinking.type,'disabled');assert.equal(r.operations.length,1);assert.ok(body.messages[0].content.includes('不需要用户额外要求'));assert.ok(body.messages[0].content.includes('新增记忆使用add'));
});
test('vague recall and follow-up topics import saved facts while excluding inactive or other-role memories',async()=>{
 const f=fixture(),soul=f.load('src/services/SoulService.ts'),c=character();c.memories=[memory('allergy','用户对花生严重过敏',{kind:'fact',factKey:'user.allergy',source:{characterId:'a'}}),memory('other','另一个角色的秘密',{source:{characterId:'b'}}),memory('deleted','删除的秘密',{inactive:true})];
 for(const request of [{history:[],query:'你还记得我吗？'},{history:[user('u','我正在点花生酱拌面'),reply('r','u','先看看菜单。')],query:'那这个呢？'}]){const built=await soul.buildCharacterRequest({character:c,...request});assert.ok(built.messages[0].content.includes('用户对花生严重过敏'));assert.ok(!built.messages[0].content.includes('另一个角色的秘密'));assert.ok(!built.messages[0].content.includes('删除的秘密'));}
});
test('recall stays within capacity and does not inject all ordinary facts on greetings',()=>{
 const recall=fixture().load('src/services/memoryEngine.ts').recallMemories,pool=Array.from({length:40},(_,i)=>memory('m'+i,'用户偏好第'+i+'种饮料',{kind:'fact',timestamp:i+1}));const r=recall('你对我了解多少',pool,6,'a',100);assert.ok(r.length>0&&r.length<=6);assert.ok(r.reduce((n,m)=>n+m.content.length,0)<=100);assert.equal(recall('早安',pool,6,'a',100).length,0);
});
test('an old zero-memory success rechecks only its latest batch once, preserving older cursor entries',async()=>{
 const c=seeded(30),s=fixture().load('src/services/memorySummary.ts');c.memoryState.cursors.a={...s.cursorFor(s.unsummarizedTurns(c.messages)),lastSuccessAt:100,lastSavedCount:0};let calls=0,seen;
 const h=await mount(c,async(_url,init)=>{calls++;seen=JSON.parse(JSON.parse(init.body).messages[1].content).新增对话;return result([]);});
 try{await until(()=>h.api().conversations[0].memoryState.cursors.a.lastResult==='empty');assert.equal(calls,1);assert.equal(seen.length,10);assert.equal(seen[0].user,'第20轮普通聊天');const stored=h.api().conversations[0];assert.equal(Object.keys(stored.memoryState.cursors.a.processed).length,30);assert.equal(stored.memoryState.cursors.a.summaryPromptVersion,2);assert.equal(s.reopenEmptySummary(stored.messages,stored.memoryState.cursors.a,10),stored.memoryState.cursors.a);await h.api().loadList();await h.api().summarizeConversation('a');assert.equal(calls,1);}finally{h.host.close();}
});
test('empty-summary recheck does not revisit user-deleted memories or disabled roles',async()=>{
 for(const blocked of [true,false]){const c=seeded(10),s=fixture().load('src/services/memorySummary.ts');c.memoryState.cursors.a={...s.cursorFor(s.unsummarizedTurns(c.messages)),lastSuccessAt:100,lastSavedCount:0};if(blocked)c.memoryState.blocked=[{content:'用户喜欢无糖热咖啡'}];else c.settings.memoryRecall.enabled=false;let calls=0;const h=await mount(c,async()=>{calls++;return result(coffee);});try{await tick();await h.api().summarizeConversation('a');assert.equal(calls,0);assert.equal(c.messages.length,h.api().conversations[0].messages.length);}finally{h.host.close();}}
});
test('summary output and input fit a small custom context window',async()=>{
 let body;const f=fixture({fetch:async(_url,init)=>{body=JSON.parse(init.body);return result([]);}});const s=f.load('src/services/memorySummary.ts');await s.summarizeNewTurns([{user:user('u','我叫小林'),assistants:[reply('r','u')]}],[],undefined,{...config,provider:'custom',contextWindow:8192});const estimate=f.load('src/services/conversationContext.ts').estimateTokens;assert.ok(body.max_tokens<8192);assert.ok(body.messages.reduce((n,m)=>n+estimate(m.content),0)+body.max_tokens+512<=8192);
});
