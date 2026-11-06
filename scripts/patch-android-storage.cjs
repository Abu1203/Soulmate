// Read old Android SQLite rows without changing the database, schema or saved bytes.
// AsyncStorage 3.1.1's legacy Room reader selects an entire history into CursorWindow.
const fs = require('node:fs');
const path = require('node:path');
const marker = '// Soulmate: read oversized legacy rows in one consistent transaction.';
function patch(source) {
  const before = '    suspend fun getValues(keys: List<String>): List<Entry>';
  if (!source.includes(marker) && source.split(before).length !== 3) throw Error('AsyncStorage source changed; review the Android history reader before building.');
  const after = `    suspend fun getValuesDirect(keys: List<String>): List<Entry>

    @Query("SELECT length(CAST(value AS BLOB)) FROM Storage WHERE \x60key\x60 = :key")
    suspend fun getValueLength(key: String): Int?

    @Query("SELECT substr(CAST(value AS BLOB), :start, :count) FROM Storage WHERE \x60key\x60 = :key")
    suspend fun getValueSlice(key: String, start: Int, count: Int): ByteArray?

    ${marker}
    @Transaction
    suspend fun getValues(keys: List<String>): List<Entry> {
        try {
            return getValuesDirect(keys)
        } catch (error: android.database.sqlite.SQLiteBlobTooBigException) {
            // Catch only a row-size failure. Corruption/IO/permission errors must still surface.
            return keys.distinct().map { key ->
                val length = getValueLength(key)
                if (length == null) Entry(key, null) else {
                    val value = java.io.ByteArrayOutputStream()
                    var offset = 0
                    while (offset < length) {
                        val count = minOf(16384, length - offset)
                        val part = getValueSlice(key, offset + 1, count)
                            ?: throw IllegalStateException("History row disappeared during read")
                        check(part.size == count) { "Incomplete history row" }
                        value.write(part)
                        offset += count
                    }
                    val decoded = Charsets.UTF_8.newDecoder()
                        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                        .decode(java.nio.ByteBuffer.wrap(value.toByteArray())).toString()
                    Entry(key, decoded)
                }
            }
        }
    }`;
  if(source.includes(marker)) {
    if(!source.includes(after))throw Error('Android history reader patch is incomplete or changed.');
    return source;
  }
  return source.replace(before, after);
}
function apply(root) {
  const file = path.join(root, 'node_modules/@react-native-async-storage/async-storage/android/src/main/kotlin/org/asyncstorage/legacy_storage/LegacyStorageSupplier.kt');
  const before = fs.readFileSync(file, 'utf8'), after = patch(before);
  if (before !== after) fs.writeFileSync(file, after);
  if (fs.readFileSync(file, 'utf8') !== after) throw Error('Android history reader patch verification failed');
  console.log('Android legacy history reader verified; database schema unchanged.');
}
module.exports = { patch, apply };
if (require.main === module) apply(path.resolve(__dirname, '..'));
