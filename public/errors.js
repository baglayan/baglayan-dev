const requestPath = document.getElementById('request-path');
try {
    requestPath.textContent = decodeURIComponent(window.location.pathname);
} catch {
    requestPath.textContent = window.location.pathname;
}

const homeCommand = document.getElementById('home-command');
const cursor = document.querySelector('.terminal-cursor');

homeCommand.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    document.getElementById('next-line').append(cursor);
    window.setTimeout(() => window.location.assign(homeCommand.href), 160);
});

document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target === document.body && !event.repeat && !event.isComposing &&
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        homeCommand.click();
    }
});

window.addEventListener('pageshow', () => {
    homeCommand.after(cursor);
});
