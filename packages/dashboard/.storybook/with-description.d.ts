/**
 * The extractJSDocPlugin replaces calls to this function at build time. It returns `any` so that
 * the spread into the story `meta` does not change the inferred story types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function withDescription(importMetaUrl: string, componentPath: string): any;
