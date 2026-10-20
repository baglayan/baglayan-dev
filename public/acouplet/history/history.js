async function loadHistory() {
    const status = document.getElementById('history-status');
    try {
        const response = await fetch('/updates/appcast.xml', { cache: 'no-cache' });
        if (!response.ok) throw new Error('Could not load release history.');
        const feed = new DOMParser().parseFromString(await response.text(), 'application/xml');
        const items = [...feed.querySelectorAll('channel > item')];
        if (feed.querySelector('parsererror') || items.length === 0) throw new Error('Invalid release history.');
        const namespace = 'http://www.andymatuschak.org/xml-namespaces/sparkle';
        items.sort((a, b) => Number(b.getElementsByTagNameNS(namespace, 'version')[0].textContent) - Number(a.getElementsByTagNameNS(namespace, 'version')[0].textContent));
        const releases = await Promise.all(items.map(async item => {
            const notesURL = new URL(item.getElementsByTagNameNS(namespace, 'releaseNotesLink')[0].textContent);
            const notes = await fetch(notesURL.pathname);
            if (!notes.ok) throw new Error('Could not load release notes.');
            const section = document.createElement('section');
            const title = document.createElement('h2');
            title.textContent = 'Version ' + item.getElementsByTagNameNS(namespace, 'shortVersionString')[0].textContent;
            section.append(title);
            for (const block of (await notes.text()).trim().split(/\r?\n\s*\r?\n/)) {
                if (block.startsWith('# Acouplet version ') || block === '## Release Notes') continue;
                const lines = block.split(/\r?\n/);
                const element = document.createElement(lines.every(line => line.startsWith('- ')) ? 'ul' : 'p');
                if (element.tagName === 'UL') {
                    for (const line of lines) {
                        const entry = document.createElement('li');
                        entry.textContent = line.slice(2);
                        element.append(entry);
                    }
                } else {
                    element.textContent = block;
                }
                section.append(element);
            }
            return section;
        }));
        document.getElementById('releases').replaceChildren(...releases);
        status.hidden = true;
    } catch {
        status.textContent = 'Version history could not be loaded. Please try again or read the releases on GitHub.';
    }
}

loadHistory();
