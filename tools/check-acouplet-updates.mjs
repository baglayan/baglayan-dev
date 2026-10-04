import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPublishedUpdates, checkUpdates, readManifest, stageUpdates } from './stage-acouplet-updates.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const directory = await mkdtemp(join(tmpdir(), 'acouplet-hosting-check-'));
const source = join(directory, 'publish');
const destination = join(directory, 'site/updates');
const contents = new Map([['appcast.xml', '<rss>Fixture only.</rss>'], ['Acouplet-1.0.dmg', 'Fixture archive.'], ['Acouplet-1.0.delta', 'Fixture delta.'], ['Acouplet-1.0.md', 'Fixture notes.']]);

async function manifest() {
  const bytes = Buffer.from([...contents].map(([name, value]) => createHash('sha256').update(value).digest('hex') + '  updates/' + name + '\n').join(''));
  const signature = sign(null, bytes, privateKey).toString('base64');
  await writeFile(join(source, 'SHA256SUMS'), bytes);
  await writeFile(join(source, 'SHA256SUMS.ed25519'), signature + '\n');
  return { bytes, signature };
}

try {
  await mkdir(join(source, 'updates'), { recursive: true });
  for (const name of ['appcast.xml', 'Acouplet-1.0.md']) await writeFile(join(source, 'updates', name), contents.get(name));
  const { bytes, signature } = await manifest();
  assert.equal(readManifest(bytes, signature, key).size, 4);
  assert.throws(() => readManifest(Buffer.from('altered'), signature, key));
  assert.throws(() => readManifest(bytes, signature));
  for (const invalid of ['../escape.md', 'appcast.xml\nextra', 'nested/file.dmg']) {
    const unsafe = Buffer.from('a'.repeat(64) + '  updates/' + invalid + '\n');
    assert.throws(() => readManifest(unsafe, sign(null, unsafe, privateKey).toString('base64'), key));
  }
  assert.equal(await stageUpdates({ source, destination, key, initialize: true }), 2);
  assert.equal((await checkUpdates(destination, key)).size, 4);
  assert.deepEqual((await readdir(destination)).sort(), ['Acouplet-1.0.md', 'SHA256SUMS', 'SHA256SUMS.ed25519', 'appcast.xml']);
  const original = await readFile(join(destination, 'Acouplet-1.0.md'));
  await writeFile(join(source, 'updates/Acouplet-1.0.md'), 'tampered');
  await assert.rejects(stageUpdates({ source, destination, key, initialize: true }), /changed/);
  assert.deepEqual(await readFile(join(destination, 'Acouplet-1.0.md')), original);
  await writeFile(join(source, 'updates/Acouplet-1.0.md'), original);
  for (const name of ['Acouplet-1.0.dmg', 'Acouplet-1.0.delta']) {
    const archive = contents.get(name);
    contents.set(name, 'tampered');
    await manifest();
    await assert.rejects(stageUpdates({ source, destination, key, initialize: true }), /previously published/);
    contents.delete(name);
    await manifest();
    await assert.rejects(stageUpdates({ source, destination, key, initialize: true }), /previously published/);
    contents.set(name, archive);
    await manifest();
    await writeFile(join(destination, name), archive);
    await assert.rejects(checkUpdates(destination, key), /binaries are not allowed/);
    await rm(join(destination, name));
  }
  await rm(join(source, 'updates/Acouplet-1.0.md'));
  await symlink(join(destination, 'Acouplet-1.0.md'), join(source, 'updates/Acouplet-1.0.md'));
  await assert.rejects(stageUpdates({ source, destination, key, initialize: true }), /regular files/);
  await rm(join(source, 'updates/Acouplet-1.0.md'));
  await writeFile(join(source, 'updates/Acouplet-1.0.md'), contents.get('Acouplet-1.0.md'));
  const downloads = [];
  const remote = async (url, options) => {
    const name = new URL(url).pathname.split('/').at(-1);
    assert.equal(options.redirect, 'error');
    assert.ok(!/\.(?:dmg|delta)$/.test(name), 'Archive downloads must never enter website staging.');
    downloads.push(name);
    return new Response(await readFile(join(source, contents.has(name) ? 'updates/' + name : name)));
  };
  assert.equal(await stageUpdates({ destination, key, fetcher: remote }), 2);
  assert.deepEqual(downloads, ['SHA256SUMS', 'SHA256SUMS.ed25519', 'appcast.xml', 'Acouplet-1.0.md']);
  assert.equal(await stageUpdates({ source, destination, key, fetcher: remote }), 2);
  await checkPublishedUpdates(destination, { key, fetcher: remote });
  const archive = contents.get('Acouplet-1.0.dmg');
  contents.set('Acouplet-1.0.dmg', 'A different published archive.');
  await manifest();
  await assert.rejects(checkPublishedUpdates(destination, { key, fetcher: remote }), /published update file/);
  contents.set('Acouplet-1.0.dmg', archive);
  contents.set('Acouplet-2.0.dmg', 'A newer published release.');
  await manifest();
  await assert.rejects(checkPublishedUpdates(destination, { key, fetcher: remote }), /published update file/);
  contents.delete('Acouplet-2.0.dmg');
  await manifest();
  await assert.rejects(stageUpdates({ source, destination, key, fetcher: async () => new Response('<html>Website</html>') }), /invalid signature/);
  await assert.rejects(stageUpdates({ destination, key, fetcher: async () => new Response('<html>Website</html>') }), /invalid signature/);
  const unpublished = join(directory, 'unpublished/updates');
  const homepage = '<!doctype html><html>Website</html>';
  const html = value => new Response(value, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  for (const fetcher of [async () => new Response('Not found', { status: 404 }), async () => html(homepage)]) {
    assert.equal(await stageUpdates({ destination: unpublished, key, fetcher }), null);
    assert.equal(await checkPublishedUpdates(unpublished, { key, fetcher }), false);
    await assert.rejects(readdir(unpublished), { code: 'ENOENT' });
    await assert.rejects(stageUpdates({ destination, key, fetcher }), /invalid signature|Could not download/);
    await assert.rejects(checkPublishedUpdates(destination, { key, fetcher }), /invalid signature|Could not download/);
    await assert.rejects(stageUpdates({ source, destination: unpublished, key, fetcher }), /invalid signature|Could not download/);
  }
  for (const fetcher of [
    async url => html(new URL(url).pathname === '/' ? homepage : '<html>Unexpected page</html>'),
    async url => new URL(url).pathname.endsWith('appcast.xml') ? new Response('<rss>Published feed</rss>') : html(homepage),
    async url => new URL(url).pathname.endsWith('SHA256SUMS') ? new Response('Not found', { status: 404 }) : html(homepage),
    async () => new Response('Unavailable', { status: 503 }),
    async () => { throw new Error('Network failure'); }
  ]) {
    await assert.rejects(stageUpdates({ destination: unpublished, key, fetcher }));
    await assert.rejects(checkPublishedUpdates(unpublished, { key, fetcher }));
    await assert.rejects(readdir(unpublished), { code: 'ENOENT' });
  }
  for (const missing of ['SHA256SUMS', 'SHA256SUMS.ed25519', 'appcast.xml']) {
    const fetcher = async (url, options) => new URL(url).pathname.endsWith('/' + missing) ? new Response('Not found', { status: 404 }) : remote(url, options);
    await assert.rejects(stageUpdates({ destination: unpublished, key, fetcher }), /Could not download/);
    await assert.rejects(checkPublishedUpdates(unpublished, { key, fetcher }));
  }
  const invalidSignature = async (url, options) => new URL(url).pathname.endsWith('SHA256SUMS.ed25519') ? new Response(Buffer.alloc(64).toString('base64')) : remote(url, options);
  await assert.rejects(stageUpdates({ destination: unpublished, key, fetcher: invalidSignature }), /invalid signature/);
  await assert.rejects(checkPublishedUpdates(unpublished, { key, fetcher: remote }), { code: 'ENOENT' });
  assert.equal(await stageUpdates({ destination: unpublished, key, fetcher: remote }), 2);
  assert.equal(await checkPublishedUpdates(unpublished, { key, fetcher: remote }), true);
  const appcast = contents.get('appcast.xml');
  contents.set('appcast.xml', '<rss>' + ' '.repeat(1024 * 1024) + '</rss>');
  await writeFile(join(source, 'updates/appcast.xml'), contents.get('appcast.xml'));
  await manifest();
  assert.equal(await stageUpdates({ destination: join(directory, 'large-feed/updates'), key, fetcher: remote }), 2);
  contents.set('appcast.xml', appcast);
  await writeFile(join(source, 'updates/appcast.xml'), appcast);
  await manifest();
  assert.equal((await checkUpdates(destination, key)).size, 4);
  await writeFile(join(destination, 'private.txt'), 'not in release');
  await assert.rejects(checkUpdates(destination, key), /unexpected/);
  console.log('Signed hosting staging: metadata-only local/remote files, no archive downloads, binary rejection, tampering, wrong key, path traversal, symlinks, complete immutable history, unpublished sites and partial publication checks passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
