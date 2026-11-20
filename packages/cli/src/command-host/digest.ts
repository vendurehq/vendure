import { createHash } from 'node:crypto';

import { compareCodeUnits } from './naming.js';

/** JSON with object keys sorted, so equal previews always give equal text. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.keys(value as Record<string, unknown>)
            .filter(key => (value as Record<string, unknown>)[key] !== undefined)
            // Not `localeCompare`: a digest must be the same in every process and locale.
            .sort(compareCodeUnits)
            .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/**
 * The digest of a preview for one consent. A caller passes it back as the value of the consent,
 * and the host computes it again from a fresh preview. Nothing is stored between the two calls.
 */
export function consentDigest(consent: string, preview: unknown): string {
    return createHash('sha256').update(canonicalJson({ consent, preview })).digest('hex').slice(0, 16);
}
