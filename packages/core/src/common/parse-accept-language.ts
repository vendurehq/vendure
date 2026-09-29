import { LanguageCode } from '@vendure/common/lib/generated-types';

/**
 * The maximum number of tags read from one header. Each tag expands into one code per subtag
 * prefix, and every code is looked up once for each string the request resolves, so a long header
 * would otherwise multiply the lookup work. The format check below bounds the expansion per tag.
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
 * the {@link LanguageCode} enum, since custom codes are permitted. A code which matches no
 * translation is skipped by the caller.
 */
export function parseAcceptLanguage(header: string | string[] | undefined): LanguageCode[] {
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (!raw) {
        return [];
    }
    const weighted: Array<{ subtags: string[]; quality: number; position: number }> = [];
    raw.split(',').forEach((entry, position) => {
        // Whitespace is legal around the semicolon and the comma, so each part is trimmed rather
        // than just the entry as a whole — otherwise the tag of `de ;q=0.5` keeps a trailing space.
        const [tag, ...parameters] = entry.split(';').map(part => part.trim());
        // A format check rather than an enum check, so that custom language codes still work while
        // anything which is not a language tag — such as an injection payload — is dropped. The
        // subtag count is bounded because each one adds another entry to the returned list.
        if (!tag || !/^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8}){0,3}$/.test(tag)) {
            return;
        }
        // Parameter names are case-insensitive, and reading `Q=0.5` as an absent weight would
        // promote the tag to full preference and reorder everything after it.
        const qualityParameter = parameters.find(p => p.toLowerCase().startsWith('q='));
        let quality = 1;
        if (qualityParameter) {
            const parsed = Number(qualityParameter.slice(2));
            // `q=0` means the client explicitly does not want that language. A weight which does
            // not parse is dropped the same way rather than guessed at.
            if (!isFinite(parsed) || parsed <= 0) {
                return;
            }
            // The scale tops out at 1, so an out-of-range weight cannot outrank an unweighted tag.
            quality = Math.min(parsed, 1);
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

/** Applies the casing `LanguageCode` values use: lowercase language, titlecase script, uppercase region. */
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
