import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getNormalizedVendureConfigPath } from '../vite-plugin-vendure-dashboard.js';

// #4931 — file URLs percent-encode special characters (a space becomes %20). Converting
// them to filesystem paths via URL.pathname keeps the encoding, producing paths like
// /Users/x/Local%20Documents/... which then fail to stat and even get mkdir'd literally.
describe('getNormalizedVendureConfigPath', () => {
    it('decodes percent-encoded characters in file URLs', () => {
        // path.resolve makes the expectation platform-correct (drive letter on Windows).
        const configPath = path.resolve('/Users/x/Local Documents/dev/my-shop/vendure-config.ts');
        const url = pathToFileURL(configPath);
        expect(url.href).toContain('%20');
        expect(getNormalizedVendureConfigPath(url)).toBe(configPath);
        expect(getNormalizedVendureConfigPath(url.href)).toBe(configPath);
    });

    it('passes plain string paths through unchanged', () => {
        const configPath = path.resolve('/Users/x/dev/my-shop/vendure-config.ts');
        expect(getNormalizedVendureConfigPath(configPath)).toBe(configPath);
    });
});
