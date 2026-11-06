const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
function fixture(extra={}) {
 const kv=new Map(),files=new Map(),faults={kv:false,file:false};
 const as={async getItem(k){return kv.get(k)??null;},async setItem(k,v){if(faults.kv)throw Error('disk');kv.set(k,v);},async removeItem(k){kv.delete(k);},async getAllKeys(){return [...kv.keys()];},async removeMany(ks){ks.forEach(k=>kv.delete(k));}};
 const fm={documentDirectory:'file://docs/',async getInfoAsync(k){return {exists:files.has(k)};},async readAsStringAsync(k){if(!files.has(k))throw Error('missing');return files.get(k);},async writeAsStringAsync(k,v){if(faults.file)throw Error('disk');files.set(k,v);},async moveAsync({from,to}){if(faults.file)throw Error('disk');files.set(to,files.get(from));files.delete(from);},async deleteAsync(k){files.delete(k);}};
 const mocks={'@react-native-async-storage/async-storage':as,'expo-file-system/legacy':fm,'expo/fetch':{fetch:extra.fetch},'expo-secure-store':{getItemAsync:async()=> 'TEST-ONLY',setItemAsync:async()=>{},deleteItemAsync:async()=>{}},...extra};
 const cache=new Map();
 function load(file){let name=path.resolve(root,file);if(!path.extname(name))name+=fs.existsSync(name+'.ts')?'.ts':'.tsx';if(cache.has(name))return cache.get(name).exports;const mod={exports:{}};cache.set(name,mod);const req=k=>Object.hasOwn(mocks,k)?mocks[k]:k.startsWith('.')?load(path.resolve(path.dirname(name),k)):require(k);const src=ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;vm.runInNewContext(src,{module:mod,exports:mod.exports,require:req,console,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,Error,AbortController,TextDecoder,TextEncoder,Uint8Array,Response,ReadableStream,fetch:extra.fetch},{filename:name});return mod.exports;}
 return {kv,files,faults,load,as,fm};
}

module.exports={fixture};
