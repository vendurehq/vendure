/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * @description
 * A constant which holds the current version of the Vendure core. You can use
 * this when your code needs to know the version of Vendure which is running.
 *
 * @example
 * ```ts
 * import { VENDURE_VERSION } from '\@vendure/core';
 *
 * console.log('Vendure version:', VENDURE_VERSION);
 * ```
 *
 * @docsCategory common
 * @since 2.0.0
 */
export const VENDURE_VERSION: string = require('../package.json').version;
