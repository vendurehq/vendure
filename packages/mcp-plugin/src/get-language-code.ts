import { LanguageCode } from '@vendure/core';
import type { Request } from 'express';

// Matches how core's RequestContextService reads languageCode for the GraphQL APIs: a format
// check, not an enum check, so custom language codes pass and anything else falls back to the
// channel default.
export function getLanguageCodeFromQuery(req: Request | undefined): LanguageCode | undefined {
    const value = req?.query?.languageCode;
    return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value) ? (value as LanguageCode) : undefined;
}
