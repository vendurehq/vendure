/*
 * Injected into the sandboxed preview iframe (allow-scripts only, so it cannot reach the Dashboard).
 * It makes the marked text of the email editable and talks to the Dashboard over a private
 * MessageChannel: on load it sends one { type: 'connect' } message to the Dashboard's exact origin,
 * with a port attached. Everything else goes over that port, so no message uses a wildcard target
 * and the iframe never listens to window messages.
 *
 * - iframe -> Dashboard: { type: 'focus', slot } and { type: 'input', slot, text }
 * - Dashboard -> iframe: { type: 'insert-variable', name }
 */

export const INLINE_EDITOR_SOURCE = 'vendure-email-editor';

const style = `
[data-email-slot] {
    outline: 1px dashed transparent;
    outline-offset: 3px;
    border-radius: 2px;
    cursor: text;
    transition: outline-color .1s;
}
[data-email-slot]:hover { outline-color: rgba(59, 130, 246, .6); }
[data-email-slot]:focus { outline: 2px solid rgb(59, 130, 246); }
[data-email-slot]:empty::before { content: attr(data-placeholder); color: #a1a1aa; }
[data-email-variable] {
    display: inline-block;
    padding: 0 4px;
    margin: 0 1px;
    border-radius: 4px;
    background: rgba(59, 130, 246, .12);
    color: rgb(29, 78, 216);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .85em;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    white-space: nowrap;
}
`;

function editorScript(source: string, dashboardOrigin: string) {
    const channel = new MessageChannel();
    const port = channel.port1;
    const post = (message: Record<string, unknown>) => port.postMessage({ source, ...message });
    const slotOf = (node: Node | null): HTMLElement | null =>
        node ? ((node instanceof HTMLElement ? node : node.parentElement)?.closest('[data-email-slot]') ?? null) : null;
    const pill = (name: string) => {
        const span = document.createElement('span');
        span.dataset.emailVariable = name;
        span.contentEditable = 'false';
        span.textContent = `{{ ${name} }}`;
        return span;
    };
    let lastSlot: HTMLElement | null = null;
    let lastRange: Range | null = null;

    document.addEventListener(
        'click',
        event => {
            // Links and buttons in the email must not navigate while editing.
            if ((event.target as HTMLElement).closest('a')) {
                event.preventDefault();
            }
        },
        true,
    );
    document.addEventListener('selectionchange', () => {
        const selection = document.getSelection();
        if (selection?.rangeCount && slotOf(selection.anchorNode)) {
            lastRange = selection.getRangeAt(0).cloneRange();
        }
    });

    document.querySelectorAll<HTMLElement>('[data-email-slot]').forEach(element => {
        const slot = element.dataset.emailSlot;
        element.contentEditable = 'true';
        element.spellcheck = true;
        element.addEventListener('focus', () => {
            lastSlot = element;
            post({ type: 'focus', slot });
        });
        // textContent, not innerText: innerText applies CSS such as text-transform: uppercase.
        element.addEventListener('input', () => post({ type: 'input', slot, text: element.textContent ?? '' }));
        element.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                // A plain line break, which the email keeps with white-space: pre-line.
                if (element.dataset.emailMultiline === 'true') {
                    document.execCommand('insertText', false, '\n');
                }
            }
        });
        element.addEventListener('paste', event => {
            event.preventDefault();
            const text = event.clipboardData?.getData('text/plain') ?? '';
            document.execCommand('insertText', false, text);
        });
    });

    port.onmessage = event => {
        const data = event.data as { source?: string; type?: string; name?: string };
        if (data?.source !== source || data.type !== 'insert-variable' || !lastSlot || !data.name) {
            return;
        }
        lastSlot.focus();
        const selection = document.getSelection();
        const range =
            lastRange && slotOf(lastRange.startContainer) === lastSlot ? lastRange : document.createRange();
        if (range !== lastRange) {
            range.selectNodeContents(lastSlot);
            range.collapse(false);
        }
        range.deleteContents();
        const node = pill(data.name);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
        post({ type: 'input', slot: lastSlot.dataset.emailSlot, text: lastSlot.textContent ?? '' });
    };
    window.parent.postMessage({ source, type: 'connect' }, dashboardOrigin, [channel.port2]);
}

/**
 * Adds the editor's style and script to the email HTML. `dashboardOrigin` is the origin the iframe may
 * send its one connect message to, i.e. `window.location.origin` of the Dashboard.
 */
export function withInlineEditor(html: string, dashboardOrigin: string): string {
    const args = `${JSON.stringify(INLINE_EDITOR_SOURCE)}, ${JSON.stringify(dashboardOrigin)}`;
    const injection = `<style>${style}</style><script>(${editorScript.toString()})(${args});</script>`;
    return html.includes('</body>') ? html.replace('</body>', `${injection}</body>`) : html + injection;
}
