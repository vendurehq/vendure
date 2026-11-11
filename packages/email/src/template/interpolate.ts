const PLACEHOLDER = /\{\{\{?\s*([\w$.[\]-]+)\s*\}?\}\}/g;

/**
 * @description
 * Replaces `{{ path.to.value }}` placeholders in a string with the matching values from
 * `vars`. Used for the subject and "from" fields of emails which are not rendered with
 * Handlebars. There is no logic, helpers or escaping: the result is plain text, so it can be
 * stored and edited as data. Missing values are replaced with an empty string.
 *
 * Triple-brace placeholders (`{{{ value }}}`) are accepted too, so existing Handlebars-style
 * subject lines keep working.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export function interpolateTemplateString(template: string, vars: Record<string, any>): string {
    return template.replace(PLACEHOLDER, (_match, path: string) => {
        const value = resolvePath(vars, path);
        if (value == null) {
            return '';
        }
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
}

function resolvePath(vars: Record<string, any>, path: string): unknown {
    const segments = path
        .replace(/\[(\w+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
    let current: any = vars;
    for (const segment of segments) {
        if (current == null) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
