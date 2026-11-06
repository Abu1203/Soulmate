// Hook/native boundary harness: real screen event handlers, not a native renderer.
const {fixture}=require('./harness.cjs');
function hookHost(){let slots=[],cursor=0,active=true,queued=false,effects=[],current,renderFn,renders=0;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const schedule=()=>{if(!queued&&active){queued=true;queueMicrotask(()=>{queued=false;if(active)render();});}};
 const react={Fragment:'Fragment',memo:fn=>fn,createContext:()=>({Provider:'Provider'}),createElement:(type,props,...children)=>({type,props:{...props,...(children.length?{children}:null)}}),
 useState(initial){const i=cursor++;if(!slots[i]){const slot={value:typeof initial==='function'?initial():initial};slot.set=v=>{const next=typeof v==='function'?v(slot.value):v;if(!Object.is(slot.value,next)){slot.value=next;schedule();}};slots[i]=slot;}return [slots[i].value,slots[i].set];},
 useRef(initial){const i=cursor++;return slots[i]||(slots[i]={current:initial});},
 useMemo(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;},
 useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
 useEffect(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps)){const prev=slots[i];slots[i]={deps,cleanup:prev?.cleanup};effects.push(()=>{prev?.cleanup?.();slots[i].cleanup=fn();});}},useContext(){return current?.props?.value;}};
 function render(){if(++renders>2000)throw Error('Render loop');cursor=0;effects=[];current=renderFn();const pending=effects;effects=[];pending.forEach(fn=>fn());}
 return {react,start(fn){renderFn=fn;render();},render,get tree(){return current;},close(){if(!active)return;active=false;slots.forEach(s=>s?.cleanup?.());}};
}
const tick=()=>new Promise(r=>setTimeout(r,3));
async function until(check){for(let i=0;i<250;i++){if(check())return;await tick();}throw Error('condition did not settle');}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(x=>nodes(x,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function label(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(label).join('');if(typeof tree!=='object')return String(tree);return label(tree.props?.children);}
function button(tree,text){const hit=nodes(tree,n=>n.type==='TouchableOpacity'&&label(n)===text)[0];if(!hit)throw Error('Missing button: '+text);return hit;}
function character(id='a'){return {id,name:'角色'+id,isPinned:false,settings:{systemPrompt:'独立角色',background:'海边',temperature:.7,topP:.9},messages:[],memories:[],createdAt:1,updatedAt:1};}
function ui(extra={}){const host=hookHost(),alerts=[],keyboard=new Map(),navEvents=new Map(),navigation={goBack(){navigation.backs++;},replace(...v){navigation.replaced.push(v);},navigate(){},dispatch(){},addListener(k,fn){navEvents.set(k,fn);return ()=>navEvents.delete(k);},isFocused:()=>true,backs:0,replaced:[]};
 class Value{constructor(v){this.v=v;}setValue(v){this.v=v;}interpolate(){return 0;}stopAnimation(){}}
 const animation=()=>({start(fn){fn?.({finished:true});},stop(){}});
 const native={...Object.fromEntries(['View','Text','TouchableOpacity','TextInput','FlatList','ScrollView','Image','ImageBackground','Pressable','Modal','KeyboardAvoidingView','ActivityIndicator','Switch'].map(k=>[k,k])),StyleSheet:{create:v=>v,absoluteFillObject:{},hairlineWidth:1},Dimensions:{get:()=>({width:390,height:844})},Platform:{OS:'android',select:v=>v.android??v.default},Alert:{alert:(...v)=>alerts.push(v)},Keyboard:{dismiss(){},addListener(k,fn){keyboard.set(k,fn);return {remove(){keyboard.delete(k);}};}},AppState:{addEventListener:()=>({remove(){}})},Vibration:{vibrate(){}},Animated:{Value,View:'Animated.View',timing:animation,spring:animation,parallel:animation,loop:()=>({start(){},stop(){}})},LayoutAnimation:{configureNext(){},Presets:{easeInEaseOut:{}}}};
 const api={conversations:[character()],activeConversation:character(),hasApiKey:true,isStreaming:false,selectedIds:new Set(),thinkingMode:'off',selectConversation(){},prepareMemoryScope:async()=>{},summarizeConversation:async()=>{},...extra.api};
 const theme={colors:new Proxy({text:'#FFFFFF',textSecondary:'#AAAAAA'}, {get:(t,k)=>t[k]||'#123456'}),isDark:true,customTheme:'default',setCustomTheme:async()=>{},...extra.theme};
 const childMocks=Object.fromEntries(['Toast','GlassModal','ThemedSheet','AgentSoulSlider','AgentSoulBackgroundPicker','MemoryRecallSettings','AgentSoulThinking','AgentSoulMessageBubble'].flatMap(k=>[['../components/'+k,{default:k}],['./'+k,{default:k}]]));
 // TS __importDefault expects CommonJS direct default exports.
 for(const k of Object.keys(childMocks))childMocks[k]=Object.values(childMocks[k])[0];
 const f=fixture({...childMocks,'../services/appDialog':{AppAlert:native.Alert},react:host.react,'react-native':native,'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'@react-navigation/native':{DrawerActions:{closeDrawer:()=>({})}},'expo-clipboard':{setStringAsync:async()=>{}},'expo-image-picker':{launchImageLibraryAsync:async()=>({canceled:true}),requestMediaLibraryPermissionsAsync:async()=>({granted:true})},'expo-file-system':{File:class{},Directory:class{},Paths:{document:'file://docs/'}},'../contexts/ThemeContext':{useTheme:()=>theme},'../contexts/AgentSoulContext':{useAgentSoul:()=>api},...extra.mocks});
 function start(name,props={}){const fn=f.load('src/'+name+'.tsx').default;host.start(()=>fn({navigation,route:{params:{}},...props}));}
 return {host,f,api,theme,alerts,keyboard,navEvents,navigation,start};
}
module.exports={hookHost,ui,nodes,label,button,character,tick,until};
