// Zod re-export for @vendure/dashboard extensions.
//
// Strategy: internal code imports from zod/v3 for stability. The package.json
// accepts "^3.25.0 || ^4.0.0" so consumers on either major version resolve
// cleanly. Extension authors should import { z, zodResolver } from
// '@vendure/dashboard' — never from 'zod' directly.
//
// @hookform/resolvers@5 detects v3 vs v4 schemas at runtime, so extensions
// using either version will work with zodResolver.

export { zodResolver } from '@hookform/resolvers/zod';
export { z } from 'zod/v3';
export type {
    ZodArray,
    ZodDefault,
    ZodEffects,
    ZodObject,
    ZodRawShape,
    ZodSchema,
    ZodType,
    ZodTypeAny,
} from 'zod/v3';
