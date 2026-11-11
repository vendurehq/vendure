/*
 * Marks the content slots in rendered email HTML, so that the Dashboard can edit the text inside its
 * preview. The template is rendered with a token in place of each slot's text. The tokens are then
 * replaced with spans carrying the slot name and showing the slot's raw text, with its
 * `{{ variables }}` as non-editable pills. Tokens in places where a span is not allowed (the document
 * title and attribute values) get the raw text instead.
 */

const TOKEN = /\[\[\[vendure-slot:([\w-]+)\]\]\]/g;

/** The text rendered in place of a slot's text while the email is rendered for editing. */
export function editableSlotToken(name: string): string {
    return `[[[vendure-slot:${name}]]]`;
}

export function markEditableContent(
    html: string,
    raw: Record<string, string>,
    multiline: ReadonlySet<string> = new Set(),
): string {
    const segments = html.split(/(<[^<>]*>)/);
    let inTitle = false;
    return segments
        .map(segment => {
            if (segment.startsWith('<')) {
                if (/^<title[\s>]/i.test(segment)) {
                    inTitle = true;
                } else if (/^<\/title>/i.test(segment)) {
                    inTitle = false;
                }
                return segment.replace(TOKEN, (_m, name: string) => escapeHtml(raw[name] ?? ''));
            }
            if (inTitle) {
                return segment.replace(TOKEN, (_m, name: string) => escapeHtml(raw[name] ?? ''));
            }
            return segment.replace(TOKEN, (_m, name: string) => slotSpan(name, raw[name] ?? '', multiline.has(name)));
        })
        .join('');
}

function slotSpan(name: string, text: string, multiline: boolean): string {
    const multilineAttribute = multiline ? ' data-email-multiline="true"' : '';
    return `<span data-email-slot="${escapeHtml(name)}"${multilineAttribute}>${withVariablePills(text)}</span>`;
}

/** Escapes the text and wraps each `{{ variable }}` in a pill the editor treats as one unit. */
export function withVariablePills(text: string): string {
    const parts = text.split(/(\{\{\{?\s*[^{}\s]+\s*\}?\}\})/);
    return parts
        .map((part, i) => {
            if (i % 2 === 0) {
                return escapeHtml(part);
            }
            const name = /\{\{\{?\s*([^{}\s]+)\s*\}?\}\}/.exec(part)?.[1] ?? '';
            return `<span data-email-variable="${escapeHtml(name)}" contenteditable="false">{{ ${escapeHtml(name)} }}</span>`;
        })
        .join('');
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
