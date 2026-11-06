// Real filesystem boundary for persistence/restart tests; never points at user data.
const fs=require('node:fs/promises'),path=require('node:path');
const {fixture}=require('./harness.cjs');
function diskFixture(directory){
 const root=path.resolve(directory);
 const file=uri=>{if(!uri.startsWith('file://docs/'))throw Error('outside fixture');const p=path.resolve(root,uri.slice('file://docs/'.length));if(!p.startsWith(root+path.sep))throw Error('outside fixture');return p;};
 const key=k=>path.join(root,'kv-'+encodeURIComponent(k));
 const read=async p=>{try{return await fs.readFile(p,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const as={getItem:k=>read(key(k)),setItem:async(k,v)=>fs.writeFile(key(k),v,'utf8'),removeItem:async k=>fs.rm(key(k),{force:true})};
 const fm={documentDirectory:'file://docs/',getInfoAsync:async uri=>{try{const s=await fs.stat(file(uri));return {exists:true,isDirectory:s.isDirectory()};}catch(e){if(e.code==='ENOENT')return {exists:false};throw e;}},readAsStringAsync:async uri=>{const v=await read(file(uri));if(v===null)throw Error('missing');return v;},writeAsStringAsync:(uri,v)=>fs.writeFile(file(uri),v,'utf8'),moveAsync:({from,to})=>fs.rename(file(from),file(to)),deleteAsync:uri=>fs.rm(file(uri),{force:true})};
 const ioErrors=[];
 for(const target of [as,fm])for(const name of Object.keys(target))if(typeof target[name]==='function'){
  const fn=target[name];target[name]=async(...args)=>{try{return await fn(...args);}catch(e){ioErrors.push({operation:name,error:e.message});throw e;}};
 }
 return {...fixture({'@react-native-async-storage/async-storage':as,'expo-file-system/legacy':fm}),ioErrors};
}
module.exports={diskFixture};
