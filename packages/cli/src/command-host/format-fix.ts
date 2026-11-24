import { Fix, isCommandFix } from '@vendure/common/lib/command';

import { kebab } from './naming.js';

/** A fix as a command line, for a person at a terminal. */
export function formatFix(fix: { path: string[]; input: Record<string, unknown> }): string {
    // A boolean flag is a switch: `--<flag>` for true, `--no-<flag>` for false. Leaving it out
    // lets the command choose, which is not the same as false.
    const flags = Object.entries(fix.input)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
            if (typeof value === 'boolean') {
                return value ? `--${kebab(key)}` : `--no-${kebab(key)}`;
            }
            return `--${kebab(key)} ${JSON.stringify(value)}`;
        });
    return ['vendure', ...fix.path, ...flags].join(' ');
}

/**
 * A fix for a person at a terminal: its description, followed by the command line when the fix
 * is a command.
 */
export function describeFix(fix: Fix): string {
    return isCommandFix(fix) ? `${fix.description}: ${formatFix(fix)}` : fix.description;
}

/**
 * The fixes in a value read from another process, such as the `fix` of a startup-error event.
 * Entries without a description are dropped, and a `path` and `input` are kept only when they
 * name a command.
 */
export function readFixes(value: unknown): Fix[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const fixes: Fix[] = [];
    for (const entry of value) {
        if (typeof entry?.description !== 'string') {
            continue;
        }
        const { description, path, input } = entry as Fix;
        const candidate: Fix = { description, path, input };
        fixes.push(isCommandFix(candidate) ? candidate : { description });
    }
    return fixes;
}
