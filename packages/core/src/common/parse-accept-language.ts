import { LanguageCode } from '@vendure/common/lib/generated-types';

/**
 * A long header would otherwise multiply into a long lookup chain, and every string resolved
 * during a request walks that chain once per source.
 */
const MAX_TAGS = 10;

/**
 * Parses an `Accept-Language` header into language codes, most preferred first.
 *
 * Each tag is also truncated subtag by subtag, so `zh-Hans-CN` yields `zh_Hans_CN`, `zh_Hans` and
 * `zh`, letting a caller fall back to a less specific catalog. Casing is normalised to the BCP 47
 * convention that {@link LanguageCode} follows, so a client sending `pt-br` still matches `pt_BR`.
 *
 * As with the `languageCode` query parameter, a returned code is not guaranteed to be a member of
 * the {@link LanguageCode} enum — a caller which finds no translation for it falls back.
 */
export function parseAcceptLanguage(header: string | string[] | undefined): LanguageCode[] {
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (!raw) {
        return [];
    }
    const weighted: Array<{ subtags: string[]; quality: number; position: number }> = [];
    raw.split(',').forEach((entry, position) => {
        const [tag, ...parameters] = entry.trim().split(';');
        // A format check rather than an enum check, so that custom language codes still work while
        // anything which is not a language tag — such as an injection payload — is dropped.
        if (!tag || !/^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/.test(tag)) {
            return;
        }
        const qualityParameter = parameters.map(p => p.trim()).find(p => p.startsWith('q='));
        const quality = qualityParameter ? Number(qualityParameter.slice(2)) : 1;
        // `q=0` means the client explicitly does not want that language.
        if (!isFinite(quality) || quality <= 0) {
            return;
        }
        weighted.push({ subtags: normalizeSubtags(tag), quality, position });
    });
    weighted.sort((a, b) => b.quality - a.quality || a.position - b.position);

    const result: LanguageCode[] = [];
    for (const { subtags } of weighted.slice(0, MAX_TAGS)) {
        for (let length = subtags.length; 0 < length; length--) {
            const candidate = subtags.slice(0, length).join('_') as LanguageCode;
            if (!result.includes(candidate)) {
                result.push(candidate);
            }
        }
    }
    return result;
}

/** Lowercase language, titlecase script, uppercase region, as `LanguageCode` values are written. */
function normalizeSubtags(tag: string): string[] {
    return tag.split('-').map((subtag, index) => {
        if (index === 0) {
            return subtag.toLowerCase();
        }
        if (subtag.length === 4) {
            return subtag[0].toUpperCase() + subtag.slice(1).toLowerCase();
        }
        if (subtag.length === 2 || /^\d{3}$/.test(subtag)) {
            return subtag.toUpperCase();
        }
        return subtag.toLowerCase();
    });
}
