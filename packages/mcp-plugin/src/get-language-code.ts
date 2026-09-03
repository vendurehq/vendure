import { LanguageCode } from '@vendure/core';
import type { Request } from 'express';

/**
 * Reads the `languageCode` query parameter the same way core's RequestContextService does for
 * the GraphQL APIs: a format check rather than an enum check, so custom language codes pass while
 * anything else is ignored and the channel default applies.
 */
export function getLanguageCodeFromQuery(req: Request | undefined): LanguageCode | undefined {
    const value = req?.query?.languageCode;
    return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value) ? (value as LanguageCode) : undefined;
}
