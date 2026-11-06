// Compiles the exact patched Kotlin reader and exercises its SQL against real SQLite.
// CursorWindow's size exception is simulated; this is not an Android device test.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {patch}=require('../scripts/patch-android-storage.cjs');
const cache=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1');
function jar(group,name,version){const root=path.join(cache,group,name,version);for(const hash of fs.readdirSync(root)){const p=path.join(root,hash,`${name}-${version}.jar`);if(fs.existsSync(p))return p;}throw Error('Missing cached test dependency: '+name);}
const compiler=jar('org.jetbrains.kotlin','kotlin-compiler-embeddable','2.1.20'),stdlib=jar('org.jetbrains.kotlin','kotlin-stdlib','2.1.20'),script=jar('org.jetbrains.kotlin','kotlin-script-runtime','2.1.20'),annotations=jar('org.jetbrains','annotations','13.0'),coroutines=jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.8.0'),sqlite=jar('org.xerial','sqlite-jdbc','3.41.2.2');
const trove=jar('org.jetbrains.intellij.deps','trove4j','1.0.20200330');
const source=patch(fs.readFileSync(path.join(__dirname,'../node_modules/@react-native-async-storage/async-storage/android/src/main/kotlin/org/asyncstorage/legacy_storage/LegacyStorageSupplier.kt'),'utf8'));
const reader=source.slice(source.indexOf('    suspend fun getValuesDirect'),source.indexOf('    @Transaction\n    @Insert'));
assert.ok(reader.includes('CodingErrorAction.REPORT'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'soulmate-native-read-'));
try{
 fs.writeFileSync(path.join(root,'AndroidStub.kt'),'package android.database.sqlite\nclass SQLiteBlobTooBigException : RuntimeException()\n');
 fs.writeFileSync(path.join(root,'ReaderCheck.kt'),`
import java.sql.DriverManager
import java.sql.Connection
import kotlin.coroutines.*
annotation class Query(val value: String)
annotation class Transaction
data class Entry(val key: String, val value: String?)
interface Reader {
${reader}
}
class SqlReader(val db:Connection):Reader {
 var corrupt=false;var short=false;var chunks=0
 override suspend fun getValuesDirect(keys:List<String>):List<Entry> {
  if(corrupt)throw java.sql.SQLException("database malformed")
  return keys.distinct().map { key ->
   db.prepareStatement("SELECT value FROM Storage WHERE key=?").use { s ->
    s.setString(1,key);s.executeQuery().use { r ->
     val v=if(r.next())r.getString(1)else null
     if((v?.toByteArray(Charsets.UTF_8)?.size?:0)>2000000)throw android.database.sqlite.SQLiteBlobTooBigException()
     Entry(key,v)
    }
   }
  }
 }
 override suspend fun getValueLength(key:String):Int? {
  db.prepareStatement("SELECT length(CAST(value AS BLOB)) FROM Storage WHERE key=?").use { s ->
   s.setString(1,key);s.executeQuery().use { r -> if(!r.next())return null;val n=r.getInt(1);return if(r.wasNull())null else n }
  }
 }
 override suspend fun getValueSlice(key:String,start:Int,count:Int):ByteArray? {
  check(count<=16384);chunks++
  if(short)return byteArrayOf()
  db.prepareStatement("SELECT substr(CAST(value AS BLOB), ?, ?) FROM Storage WHERE key=?").use { s ->
   s.setInt(1,start);s.setInt(2,count);s.setString(3,key);s.executeQuery().use { r -> return if(r.next())r.getBytes(1)else null }
  }
 }
}
fun main(args:Array<String>) {
 Class.forName("org.sqlite.JDBC")
 DriverManager.getConnection("jdbc:sqlite:"+args[0]).use { db ->
  db.createStatement().use { it.execute("CREATE TABLE Storage(key TEXT NOT NULL PRIMARY KEY,value TEXT)") }
  val text="中文🐈𠮷\\u0000".repeat(260000)+"完整结尾"+0.toChar()+"保留零字符后正文"
  db.prepareStatement("INSERT INTO Storage VALUES(?,?)").use { s -> s.setString(1,"history");s.setString(2,text);s.executeUpdate();s.setString(1,"empty");s.setString(2,"");s.executeUpdate() }
  val before=java.nio.file.Files.readAllBytes(java.nio.file.Path.of(args[0]))
  val reader=SqlReader(db);db.autoCommit=false
  var result:Result<Unit>?=null
  suspend {
   var failed=false;try{reader.getValuesDirect(listOf("history"))}catch(e:android.database.sqlite.SQLiteBlobTooBigException){failed=true};check(failed)
   val values=reader.getValues(listOf("history","empty","missing"))
   check(values[0].value==text);check(values[1].value=="");check(values[2].value==null);check(reader.chunks>100)
   val count=reader.chunks;reader.corrupt=true
   var error=false;try{reader.getValues(listOf("history"))}catch(e:java.sql.SQLException){error=true};check(error&&reader.chunks==count)
   reader.corrupt=false;reader.short=true;error=false
   try{reader.getValues(listOf("history"))}catch(e:IllegalStateException){error=true};check(error)
  }.startCoroutine(object:Continuation<Unit>{override val context=EmptyCoroutineContext;override fun resumeWith(r:Result<Unit>){result=r}})
  check(result!=null);result!!.getOrThrow();db.commit()
  check(before.contentEquals(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(args[0]))))
  println("PASS: original large-row failure reproduced; "+text.toByteArray(Charsets.UTF_8).size+" bytes restored exactly; Unicode/NUL preserved; malformed/short reads rejected; SQLite file unchanged")
 }
}
`);
 const compilation=cp.spawnSync('java',['-cp',[compiler,stdlib,script,coroutines,annotations,trove].join(path.delimiter),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-classpath',[stdlib,sqlite,annotations].join(path.delimiter),'-d',path.join(root,'classes'),path.join(root,'AndroidStub.kt'),path.join(root,'ReaderCheck.kt')],{encoding:'utf8',timeout:90000});
 if(compilation.status!==0)throw Error(compilation.stdout+compilation.stderr);
 const run=cp.spawnSync('java',['-cp',[path.join(root,'classes'),stdlib,sqlite].join(path.delimiter),'ReaderCheckKt',path.join(root,'history.sqlite')],{encoding:'utf8',timeout:90000});
 if(run.status!==0)throw Error(run.stdout+run.stderr);process.stdout.write(run.stdout);
}finally{
 const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('soulmate-native-read-'))throw Error('Unsafe test cleanup path');
 fs.rmSync(resolved,{recursive:true,force:true});
}
