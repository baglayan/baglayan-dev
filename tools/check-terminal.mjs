import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function element() {
    return {
        childNodes: [],
        listeners: {},
        style: { setProperty() {} },
        classList: { add() {} },
        value: '',
        selectionStart: 0,
        selectionEnd: 0,
        addEventListener(type, listener) { this.listeners[type] = listener; },
        append(...children) { this.childNodes.push(...children); },
        replaceChildren() { this.childNodes = []; },
        cloneNode() { return element(); },
        getBoundingClientRect() { return { left: 0, top: 0, bottom: 20, width: 10, height: 20 }; },
        getClientRects() { return [this.getBoundingClientRect()]; },
        focus() {},
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    };
}

const elements = new Map();
const getElement = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
};
const form = getElement('terminal-form');
const input = getElement('terminal-input');
const history = getElement('terminal-history');
const document = {
    ...element(),
    getElementById: getElement,
    querySelector: getElement,
    createElement: element,
    fonts: { ready: Promise.resolve() },
};
const navigations = [];
let closes = 0;
const window = { ...element(), close() { closes++; }, setTimeout(callback) { callback(); }, location: { assign(path) { navigations.push(path); } } };
form.querySelector = getElement;
getElement('.directory-list').querySelectorAll = () => ['github', 'email', 'acouplet', 'linkedin', 'resume'].map(textContent => ({ textContent }));
const context = vm.createContext({ document, window, getComputedStyle: () => ({ marginTop: '0', lineHeight: '20', paddingTop: '0', paddingBottom: '0' }) });
vm.runInContext(readFileSync(new URL('../public/terminal.js', import.meta.url), 'utf8'), context);
form.requestSubmit = () => form.listeners.submit({ preventDefault() {} });
const submit = value => {
    input.value = value;
    form.requestSubmit();
};
const key = (value, options = {}, target = input) => {
    const event = { key: value, target, preventDefault() { this.defaultPrevented = true; }, ...options };
    target.listeners.keydown(event);
    return event;
};

submit('ls -l');
assert.equal(history.childNodes.length, 2);
assert.equal(history.childNodes[0].childNodes.at(-1).textContent, ' ls -l');
submit('info --help');
assert.equal(history.childNodes.at(-1).childNodes.length, 2);
submit('clear --all');
assert.equal(history.childNodes.length, 0);
submit('');
assert.equal(history.childNodes.length, 1);
input.value = 'resume';
assert.equal(key('c', { ctrlKey: true }).defaultPrevented, true);
assert.equal(input.value, '');
assert.equal(history.childNodes.length, 2);
assert.equal(history.childNodes.at(-1).childNodes.at(-1).textContent, ' ');
key('ArrowUp');
assert.equal(input.value, 'clear --all');
assert.deepEqual(navigations, []);
for (const path of ['', '.', '..', '~', '/']) submit(`cd ${path}`);
assert.deepEqual(navigations, []);
for (const command of ['cd github', 'cd resume', 'resume --help']) {
    submit(command);
    window.listeners.pageshow();
}
assert.deepEqual(navigations, ['/github', '/resume', '/resume']);
submit('exit --help');
assert.equal(closes, 1);
key('d', { ctrlKey: true });
assert.equal(closes, 2);
const lines = history.childNodes.length;
input.value = 'github';
key('c', { ctrlKey: true }, document);
assert.equal(history.childNodes.length, lines + 1);
assert.equal(input.value, '');
key('d', { ctrlKey: true }, document);
assert.equal(closes, 3);
assert.equal(key('c', { metaKey: true }).defaultPrevented, undefined);
assert.equal(key('d', { ctrlKey: true, isComposing: true }).defaultPrevented, undefined);
assert.equal(closes, 3);
console.log('Terminal: command arguments, cd targets, empty Enter, Ctrl-C, exit and Ctrl-D passed.');
