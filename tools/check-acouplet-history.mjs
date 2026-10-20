import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function element(tagName = '') {
    return {
        tagName: tagName.toUpperCase(),
        childNodes: [],
        textContent: '',
        hidden: false,
        append(...children) { this.childNodes.push(...children); },
        replaceChildren(...children) { this.childNodes = children; },
    };
}

const releases = [
    { version: '9', shortVersionString: '1.0', releaseNotesLink: 'https://baglayan.dev/updates/Acouplet-1.0.md' },
    { version: '10', shortVersionString: '1.1', releaseNotesLink: 'https://baglayan.dev/updates/Acouplet-1.1.md' },
];
const notes = new Map([
    ['/updates/Acouplet-1.0.md', '# Acouplet version 1.0 Early Alpha\n\n## Release Notes\n\nInitial release.\n'],
    ['/updates/Acouplet-1.1.md', '# Acouplet version 1.1 Early Alpha\n\n## Release Notes\n\n- First improvement.\n- Literal <script> text.\n'],
]);
const script = readFileSync(new URL('../public/acouplet/history/history.js', import.meta.url), 'utf8');

async function check({ failedURL, invalidFeed = false } = {}) {
    const status = element();
    const history = element();
    const requests = [];
    const document = {
        getElementById: id => id === 'history-status' ? status : history,
        createElement: element,
    };
    class DOMParser {
        parseFromString() {
            return {
                querySelector: () => invalidFeed,
                querySelectorAll: () => releases.map(release => ({
                    getElementsByTagNameNS: (namespace, name) => [{ textContent: release[name] }],
                })),
            };
        }
    }
    const fetch = async (url, options) => {
        requests.push(url);
        if (url === '/updates/appcast.xml') assert.equal(options.cache, 'no-cache');
        return { ok: url !== failedURL, text: async () => notes.get(url) || 'Fixture feed.' };
    };
    await vm.runInNewContext(script, { document, DOMParser, fetch, URL });
    return { status, history, requests };
}

const { status, history, requests } = await check();
assert.equal(status.hidden, true);
assert.deepEqual(requests, ['/updates/appcast.xml', '/updates/Acouplet-1.1.md', '/updates/Acouplet-1.0.md']);
assert.deepEqual(history.childNodes.map(section => section.childNodes[0].textContent), ['Version 1.1', 'Version 1.0']);
assert.equal(history.childNodes[0].childNodes[1].tagName, 'UL');
assert.deepEqual(history.childNodes[0].childNodes[1].childNodes.map(entry => entry.textContent), ['First improvement.', 'Literal <script> text.']);
assert.equal(history.childNodes[1].childNodes[1].textContent, 'Initial release.');
for (const options of [{ failedURL: '/updates/appcast.xml' }, { failedURL: '/updates/Acouplet-1.0.md' }, { invalidFeed: true }]) {
    const result = await check(options);
    assert.equal(result.status.hidden, false);
    assert.match(result.status.textContent, /could not be loaded/);
    assert.equal(result.history.childNodes.length, 0);
}
console.log('Version history: all releases, numeric order, paragraphs, lists, literal text and loading failures passed.');
