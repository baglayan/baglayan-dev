const terminalForm = document.getElementById('terminal-form');
const terminalWindow = document.querySelector('.window');
const terminalHistory = document.getElementById('terminal-history');
const terminalInput = document.getElementById('terminal-input');
const terminalEntry = document.querySelector('.terminal-entry');
const terminalMirror = document.querySelector('.terminal-mirror');
const terminalPrefix = document.querySelector('.terminal-prefix');
const terminalPosition = document.querySelector('.terminal-position');
const cursor = document.querySelector('.terminal-cursor');
const directoryList = document.querySelector('.directory-list');
const information = ['profile-name', 'profile-role'].map(id => document.getElementById(id).textContent);
const destinations = [...directoryList.querySelectorAll('a')].map(link => link.textContent);
const initialPromptStyle = getComputedStyle(terminalForm);
const initialHistoryLines = (directoryList.getBoundingClientRect().bottom - terminalHistory.getBoundingClientRect().top +
    parseFloat(initialPromptStyle.marginTop)) / parseFloat(initialPromptStyle.lineHeight);
const commandHistory = [];
let historyIndex = 0;
let historyDraft = '';
let lastCompletion = null;

function updateCursor() {
    terminalEntry.style.setProperty('--prompt-width', `${terminalForm.querySelector('label').getBoundingClientRect().width}px`);
    terminalPrefix.textContent = terminalInput.value.slice(0, terminalInput.selectionStart);
    terminalPosition.textContent = terminalInput.value.slice(terminalInput.selectionStart) || '\u00a0';
    terminalInput.style.height = `${terminalMirror.getBoundingClientRect().height}px`;
    const entry = terminalEntry.getBoundingClientRect();
    const position = terminalPosition.getClientRects()[0];
    terminalEntry.style.setProperty('--caret-x', `${position.left - entry.left}px`);
    terminalEntry.style.setProperty('--caret-y', `${position.top - entry.top}px`);
    cursor.style.visibility = terminalInput.readOnly || terminalInput.selectionStart === terminalInput.selectionEnd ? 'visible' : 'hidden';
}

function sizeTerminal() {
    const windowStyle = getComputedStyle(terminalWindow);
    const promptStyle = getComputedStyle(terminalForm);
    const height = parseFloat(windowStyle.paddingTop) + (initialHistoryLines + 1) * parseFloat(promptStyle.lineHeight) +
        parseFloat(windowStyle.paddingBottom);
    terminalWindow.style.height = `${Math.ceil(height)}px`;
    updateCursor();
}

terminalInput.addEventListener('input', () => {
    lastCompletion = null;
    updateCursor();
    terminalWindow.scrollTop = terminalWindow.scrollHeight;
});
function handleCommandKey(event) {
    if (event.isComposing || event.metaKey || event.altKey || terminalInput.readOnly) return;
    if (event.ctrlKey) {
        if (event.key.toLowerCase() === 'd') {
            event.preventDefault();
            window.close();
        } else if (event.key.toLowerCase() === 'c') {
            event.preventDefault();
            terminalInput.value = '';
            terminalForm.requestSubmit();
        }
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        terminalForm.requestSubmit();
    } else if (!event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        if (!commandHistory.length) return;
        if (historyIndex === commandHistory.length) historyDraft = terminalInput.value;
        historyIndex = Math.max(0, Math.min(commandHistory.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
        terminalInput.value = historyIndex === commandHistory.length ? historyDraft : commandHistory[historyIndex];
        terminalInput.setSelectionRange(terminalInput.value.length, terminalInput.value.length);
        lastCompletion = null;
        updateCursor();
        terminalWindow.scrollTop = terminalWindow.scrollHeight;
    } else if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        const before = terminalInput.value.slice(0, terminalInput.selectionStart);
        const match = /^(\s*(?:cd\s+)?)([^\s]*)$/.exec(before);
        if (!match) return;
        const directory = /^\s*cd\s+/.test(before);
        const choices = match[2].startsWith('/') ? destinations.map(value => '/' + value) :
            directory ? [...destinations, '.', '..', '~'] : ['ls', 'info', 'clear', 'exit', 'cd', ...destinations];
        const matches = choices.filter(value => value.startsWith(match[2]));
        if (!matches.length) return;
        let completed = matches[0];
        for (const value of matches) {
            while (!value.startsWith(completed)) completed = completed.slice(0, -1);
        }
        if (completed.length > match[2].length || matches.length === 1) {
            const end = terminalInput.selectionEnd + terminalInput.value.slice(terminalInput.selectionEnd).match(/^\S*/)[0].length;
            terminalInput.setRangeText(completed === 'cd' && !directory ? 'cd ' : completed, match[1].length, end, 'end');
            lastCompletion = null;
        } else if (lastCompletion !== before) {
            const output = document.createElement('div');
            output.className = 'terminal-output terminal-completions';
            output.style.setProperty('--completion-width', `${Math.max(...matches.map(value => value.length))}ch`);
            for (const value of matches) {
                const choice = document.createElement('span');
                choice.textContent = value;
                output.append(choice);
            }
            terminalHistory.append(output);
            lastCompletion = before;
        }
        updateCursor();
        terminalWindow.scrollTop = terminalWindow.scrollHeight;
    }
}

terminalInput.addEventListener('keydown', handleCommandKey);
document.addEventListener('selectionchange', updateCursor);
window.addEventListener('resize', sizeTerminal);
document.fonts.ready.then(() => {
    sizeTerminal();
    terminalWindow.scrollTop = terminalWindow.scrollHeight;
});

let wheelDelta = 0;
terminalWindow.addEventListener('wheel', event => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const lineHeight = parseFloat(getComputedStyle(terminalInput).lineHeight);
    if (Math.sign(wheelDelta) !== Math.sign(event.deltaY)) wheelDelta = 0;
    wheelDelta += event.deltaY * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? terminalWindow.clientHeight : 1);
    const lines = Math.trunc(wheelDelta / lineHeight);
    if (lines) {
        const bottom = terminalWindow.scrollHeight - terminalWindow.clientHeight;
        const offset = Math.round((bottom - terminalWindow.scrollTop) / lineHeight);
        terminalWindow.scrollTop = bottom - (offset - lines) * lineHeight;
        wheelDelta -= lines * lineHeight;
    }
}, { passive: false });

document.addEventListener('keydown', event => {
    if (event.target !== terminalInput && event.ctrlKey && ['c', 'd'].includes(event.key.toLowerCase())) {
        handleCommandKey(event);
        return;
    }
    if (event.target === terminalInput || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (event.key === 'Enter' && !event.target.closest('a')) {
        event.preventDefault();
        terminalForm.requestSubmit();
        return;
    }
    if (['ArrowUp', 'ArrowDown', 'Tab'].includes(event.key) && !event.shiftKey && !event.target.closest('a')) {
        terminalInput.focus({ preventScroll: true });
        handleCommandKey(event);
        return;
    }
    if (event.key.length === 1 || ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        terminalInput.focus({ preventScroll: true });
    }
});

terminalForm.addEventListener('submit', event => {
    event.preventDefault();
    if (terminalInput.readOnly) return;
    const input = terminalInput.value.trim();
    const command = input.split(/\s+/)[0];
    if (command) commandHistory.push(terminalInput.value);
    historyIndex = commandHistory.length;
    historyDraft = '';
    lastCompletion = null;
    if (command === 'exit') {
        window.close();
        return;
    }
    if (command === 'clear') {
        terminalHistory.replaceChildren();
        terminalInput.value = '';
        terminalInput.focus({ preventScroll: true });
        updateCursor();
        terminalWindow.scrollTop = 0;
        return;
    }
    const isChangeDirectory = command === 'cd';
    const path = isChangeDirectory ? input.slice(2).trim() : destinations.includes(command) ? command : input;
    if (!command || command === 'ls' || command === 'info' || (isChangeDirectory && ['', '.', '..', '~', '/'].includes(path))) {
        const line = document.createElement('p');
        line.className = 'terminal-command';
        const prompt = terminalForm.querySelector('label').cloneNode(true);
        const text = document.createElement('span');
        text.className = 'command';
        text.textContent = ' ' + terminalInput.value;
        line.append(...prompt.childNodes, text);
        terminalHistory.append(line);
        if (command === 'ls') {
            const output = directoryList.cloneNode(true);
            output.classList.add('terminal-output');
            terminalHistory.append(output);
        } else if (command === 'info') {
            const output = document.createElement('div');
            output.className = 'terminal-output';
            for (const value of information) {
                const paragraph = document.createElement('p');
                paragraph.textContent = value;
                output.append(paragraph);
            }
            terminalHistory.append(output);
        }
        terminalInput.value = '';
        terminalInput.focus({ preventScroll: true });
        updateCursor();
        terminalWindow.scrollTop = terminalWindow.scrollHeight;
        return;
    }
    terminalInput.readOnly = true;
    document.getElementById('next-line').append(cursor);
    updateCursor();
    const destination = '/' + path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    terminalWindow.scrollTop = terminalWindow.scrollHeight;
    window.setTimeout(() => window.location.assign(destination), 160);
});

window.addEventListener('pageshow', () => {
    terminalInput.readOnly = false;
    terminalEntry.append(cursor);
    terminalInput.focus({ preventScroll: true });
    updateCursor();
});
