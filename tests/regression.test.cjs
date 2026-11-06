const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs');
const conv=(id,t)=>({id,name:id,settings:{},messages:[],createdAt:t,updatedAt:t});
test('commit revisions survive one engine failing and do not resurrect deleted conversations',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts');
 const a=new SnapshotStore('key','test.json',Array.isArray);await a.read();await a.write([conv('old',1),conv('new',2)]);
 f.faults.file=true;await a.write([conv('old',1)]);f.faults.file=false;
 let b=new SnapshotStore('key','test.json',Array.isArray);assert.deepEqual(JSON.parse(JSON.stringify((await b.read()).value)).map(c=>c.id),['old']);
 f.faults.kv=true;await b.write([]);f.faults.kv=false;
 b=new SnapshotStore('key','test.json',Array.isArray);assert.equal((await b.read()).value.length,0);
});
test('first commit in file survives an empty legacy AsyncStorage value',async()=>{
 const f=fixture();f.kv.set('@agentsoul_conversations','[]');const s=f.load('src/services/agentsoulStorage.ts');await s.loadConversations();f.faults.kv=true;
 await s.writeConversationsImmediate([conv('new',1)]);f.faults.kv=false;
 assert.equal((await s.loadConversations()).conversations[0].id,'new');assert.equal(f.kv.get('@agentsoul_conversations'),'[]');
});
test('conflicting legacy copies are protected instead of automatically choosing by timestamps',async()=>{
 const f=fixture();f.kv.set('@agentsoul_conversations',JSON.stringify([conv('a',1)]));f.files.set('file://docs/soulmate_conversations.json',JSON.stringify([conv('b',2)]));const s=f.load('src/services/agentsoulStorage.ts');assert.equal((await s.loadConversations()).corrupt,true);const originalKv=new Map(f.kv),originalFiles=new Map(f.files);await s.writeConversationsImmediate([]);for(const [k,v] of originalKv)assert.equal(f.kv.get(k),v);for(const [k,v] of originalFiles)assert.equal(f.files.get(k),v);assert.ok(f.kv.has(s.CONTINUITY_KEY));assert.ok(f.files.get('file://docs/soulmate_conversations.json').includes('b'));
});
test('invalid array elements do not pass storage validation',async()=>{const f=fixture(),s=f.load('src/services/agentsoulStorage.ts');assert.equal(s.validConversations([null]),false);f.kv.set('@agentsoul_conversations','[null]');assert.equal((await s.loadConversations()).corrupt,true);});
test('both failed engines reject saves; retry can persist the pending snapshot',async()=>{const f=fixture(),s=f.load('src/services/agentsoulStorage.ts');await s.loadConversations();f.faults.kv=f.faults.file=true;const p=s.saveConversations([conv('a',1)]);const rejected=assert.rejects(p);assert.equal(await s.flushConversationsNow(),false);await rejected;f.faults.kv=false;assert.equal(await s.flushConversationsNow(),true);assert.equal((await s.loadConversations()).conversations[0].id,'a');});
test('SSE preserves independent whitespace, CRLF, split frames and final buffered event',()=>{const f=fixture(),{SSEParser}=f.load('src/services/sseParser.ts');let text='';const p=new SSEParser(d=>{if(d!=='[DONE]')text+=JSON.parse(d).choices[0].delta.content;});const delta=v=>'data:'+JSON.stringify({choices:[{delta:{content:v}}]})+'\r\n\r\n';const raw=['hello',' ','world','\n','尾句'].map(delta).join('');for(let i=0;i<raw.length;i+=3)p.push(raw.slice(i,i+3));p.finish();assert.equal(text,'hello world\n尾句');});
test('SSE errors throw and DONE prevents processing trailing events',()=>{const f=fixture(),{parseSSE,SSEParser}=f.load('src/services/sseParser.ts');assert.throws(()=>parseSSE('data:{"error":{"message":"failure"}}\n\n'),/failure/);const got=[];const p=new SSEParser(d=>got.push(d));p.push('data: [DONE]\n\ndata: ignored\n\n');assert.deepEqual(got,['[DONE]']);});
test('moment audience applies to all model contexts, including explicit empty audiences',()=>{const f=fixture(),{visibleMoments}=f.load('src/services/visibility.ts');assert.equal(visibleMoments([{aiIds:['a']}],'b').length,0);assert.equal(visibleMoments([{aiIds:[]}],'b').length,0);assert.equal(visibleMoments([{aiIds:[],authorConvId:'a'}],'a').length,1);});
test('moments storage errors reject rather than clearing a draft as if posted',async()=>{const f=fixture(),s=f.load('src/services/momentsStorage.ts');f.faults.kv=f.faults.file=true;await assert.rejects(s.addMoment({id:'m',content:'hi',images:[],comments:[]}));});
test('damaged moments remain unchanged',async()=>{const f=fixture(),s=f.load('src/services/momentsStorage.ts');f.kv.set('@soulmate_moments','[bad');await assert.rejects(s.addMoment({id:'m',content:'hi',images:[],comments:[]}));assert.equal(f.kv.get('@soulmate_moments'),'[bad');});

