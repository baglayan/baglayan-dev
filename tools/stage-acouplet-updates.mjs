import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const publicKey = 'kWAD8GKHAOt8Kdk3e6g8wRvCz6q3ckD1Y3oHmoHBdWI=';
const origin = 'https://baglayan.dev/updates/';
const output = resolve('public/updates');
const manifestNames = ['SHA256SUMS', 'SHA256SUMS.ed25519'];

function keyObject(key) {
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key, 'base64')]), format: 'der', type: 'spki' });
}

function isMetadata(name) {
  return /\.(?:xml|md|html|txt)$/.test(name);
}

export function readManifest(bytes, signature, key = publicKey) {
  if (!verify(null, bytes, keyObject(key), Buffer.from(signature.toString().trim(), 'base64'))) {
    throw new Error('The update file list is missing or has an invalid signature. No website files were changed.');
  }
  const files = new Map();
  for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  updates\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:xml|dmg|md|html|txt|delta))$/.exec(line);
    if (!match || files.has(match[2])) throw new Error('Invalid or repeated filename in the signed update file list.');
    files.set(match[2], match[1]);
  }
  if (!files.has('appcast.xml')) throw new Error('The signed update file list has no appcast.');
  return files;
}

async function fileHash(path) {
  if (!(await lstat(path)).isFile()) throw new Error('Update files must be regular files.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

export async function checkUpdates(directory, key = publicKey) {
  const checksums = await readFile(join(directory, manifestNames[0]));
  const signature = await readFile(join(directory, manifestNames[1]));
  const files = readManifest(checksums, signature, key);
  const metadata = [...files].filter(([name]) => isMetadata(name));
  const names = await readdir(directory);
  if (names.length !== metadata.length + 2 || names.some(name => !manifestNames.includes(name) && (!isMetadata(name) || !files.has(name)))) {
    throw new Error('The staged update directory contains missing or unexpected files. Only signed metadata and checksum files can be hosted; binaries are not allowed.');
  }
  for (const [name, digest] of metadata) {
    if (await fileHash(join(directory, name)) !== digest) throw new Error('Update file changed: ' + name);
  }
  return files;
}

async function download(name, path, fetcher, limit, allowNotFound = false) {
  const response = await fetcher(new URL(name, origin).href, { redirect: 'error', signal: AbortSignal.timeout(300000) });
  if (allowNotFound && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok || !response.body) throw new Error('Could not download the signed update file: ' + name);
  let bytes = 0;
  const bounded = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limit ? new Error('Update file exceeds its download limit: ' + name) : null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), bounded, createWriteStream(path, { flags: 'wx' }));
  return response;
}

async function publishedUpdatesAbsent(directory, fetcher) {
  try {
    await lstat(directory);
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = await mkdtemp(join(tmpdir(), 'acouplet-updates-presence-'));
  try {
    const names = [...manifestNames, 'appcast.xml'];
    const responses = [];
    for (const name of names) {
      const response = await download(name, join(temporary, name), fetcher, 1024 * 1024, true);
      if (response && !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) return false;
      responses.push(response);
    }
    if (responses.every(response => response === null)) return true;
    if (responses.some(response => response === null)) return false;
    const homepage = join(temporary, 'homepage');
    const response = await download('../', homepage, fetcher, 1024 * 1024);
    if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) return false;
    const html = await readFile(homepage);
    for (const name of names) {
      if (!(await readFile(join(temporary, name))).equals(html)) return false;
    }
    return true;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function checkPublishedHistory(files, key, fetcher) {
  const directory = await mkdtemp(join(tmpdir(), 'acouplet-published-updates-'));
  try {
    for (const name of manifestNames) await download(name, join(directory, name), fetcher, 1024 * 1024);
    const previous = readManifest(await readFile(join(directory, manifestNames[0])), await readFile(join(directory, manifestNames[1])), key);
    for (const [name, digest] of previous) {
      if (name !== 'appcast.xml' && files.get(name) !== digest) {
        throw new Error('The release would remove or replace a published update file: ' + name);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function checkPublishedUpdates(directory, { key = publicKey, fetcher = fetch, initialize = false } = {}) {
  if (!initialize && await publishedUpdatesAbsent(directory, fetcher)) return false;
  const files = await checkUpdates(directory, key);
  if (!initialize) await checkPublishedHistory(files, key, fetcher);
  return true;
}

export async function stageUpdates({ source, destination = output, key = publicKey, fetcher = fetch, initialize = false } = {}) {
  if (!source && await publishedUpdatesAbsent(destination, fetcher)) return null;
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), '.acouplet-updates-'));
  const staged = join(temporary, 'updates');
  await mkdir(staged);
  try {
    for (const name of manifestNames) {
      if (source) await writeFile(join(staged, name), await readFile(join(source, name)));
      else await download(name, join(staged, name), fetcher, 1024 * 1024);
    }
    const files = readManifest(await readFile(join(staged, manifestNames[0])), await readFile(join(staged, manifestNames[1])), key);
    const metadata = [...files.keys()].filter(isMetadata);
    for (const name of metadata) {
      const target = join(staged, name);
      if (source) {
        const incoming = join(source, 'updates', name);
        if (!(await lstat(incoming)).isFile()) throw new Error('Update sources must be regular files.');
        await pipeline(createReadStream(incoming), createWriteStream(target, { flags: 'wx' }));
      } else {
        await download(name, target, fetcher, 1024 * 1024 * 1024);
      }
    }
    await checkUpdates(staged, key);
    if (source && !initialize) await checkPublishedHistory(files, key, fetcher);
    const existing = (await readdir(dirname(destination))).includes(basename(destination));
    if (existing) {
      const previous = await checkUpdates(destination, key);
      for (const [name, digest] of previous) {
        if (name !== 'appcast.xml' && files.get(name) !== digest) {
          throw new Error('The update would remove or replace a previously published file: ' + name);
        }
      }
      await rename(destination, join(temporary, 'previous'));
    }
    try {
      await rename(staged, destination);
    } catch (error) {
      if (existing) await rename(join(temporary, 'previous'), destination);
      throw error;
    }
    return metadata.length;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--check-published') {
      const published = await checkPublishedUpdates(output, { initialize: process.env.ACOUPLET_INITIALIZE_UPDATES === 'YES' });
      console.log(published ? 'Signed update files and published history verified.' : 'No published updates; website-only deployment.');
    } else if (args.length === 1 && args[0] === '--check') {
      await checkUpdates(output);
      console.log('Signed update files verified.');
    } else if (args.length === 0 || ((args.length === 2 || (args.length === 3 && args[2] === '--initialize')) && args[0] === '--source')) {
      const count = await stageUpdates({ source: args[1] && resolve(args[1]), initialize: args[2] === '--initialize' });
      console.log(count === null ? 'No published updates; website-only deployment.' : 'Signed update files staged: ' + count);
    } else {
      throw new Error('Usage: node tools/stage-acouplet-updates.mjs [--source /path/to/publish [--initialize] | --check | --check-published]');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
