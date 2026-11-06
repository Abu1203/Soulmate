const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const pkg = read('package.json'), lock = read('package-lock.json'), config = read('app.json').expo;
assert.equal(pkg.version, config.version, 'App and package versions differ');
assert.equal(lock.version, pkg.version, 'Lockfile version differs');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version differs');
assert.ok(Number.isSafeInteger(config.android.versionCode) && config.android.versionCode > 0);
assert.ok(config.android.package);
assert.ok(pkg.scripts.postinstall.includes('node scripts/patch-android-storage.cjs'));
const reader = fs.readFileSync(path.join(root, 'node_modules/@react-native-async-storage/async-storage/android/src/main/kotlin/org/asyncstorage/legacy_storage/LegacyStorageSupplier.kt'), 'utf8');
assert.equal(require('./patch-android-storage.cjs').patch(reader), reader, 'Run npm run postinstall first');
const gradlePath = path.join(root, 'android/app/build.gradle');
if (fs.existsSync(gradlePath)) {
  const gradle = fs.readFileSync(gradlePath, 'utf8');
  const field = name => gradle.match(new RegExp('\\b' + name + '\\s+[\'"]?([^\'"\\s]+)'))?.[1];
  assert.equal(field('applicationId'), config.android.package);
  assert.equal(Number(field('versionCode')), config.android.versionCode);
  assert.equal(field('versionName'), config.version);
}
console.log(`Source configuration verified: ${config.version} (${config.android.versionCode}).`);
console.log('Signing, device behavior and upgrade compatibility require separate verification.');
