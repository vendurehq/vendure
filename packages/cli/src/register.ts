/**
 * Preload entry point which enables running TypeScript files directly with Node.js:
 *
 * ```sh
 * node --require @vendure/cli/register ./src/index.ts
 * ```
 *
 * See {@link registerTypeScript} for details. Set the `VENDURE_TSCONFIG` env var to use
 * a tsconfig file other than the nearest `tsconfig.json`.
 */
import { registerTypeScript } from './shared/register-typescript';

registerTypeScript();
