const {fixture}=require('./harness.cjs');
function recoveryFixture(){
 const f=fixture({'react-native':{Platform:{OS:'android'}},'expo-file-system':{File:class{}}});
 f.fm.EncodingType={Base64:'base64'};
 f.fm.makeDirectoryAsync=async uri=>{f.files.set(uri,'DIRECTORY');};
 f.fm.readDirectoryAsync=async uri=>[...f.files.keys()].filter(k=>k.startsWith(uri)&&!k.slice(uri.length).includes('/')&&k!==uri).map(k=>k.slice(uri.length));
 return f;
}
module.exports={recoveryFixture};
