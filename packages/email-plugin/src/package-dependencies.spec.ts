import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// https://github.com/vendurehq/vendure/issues/4920
//
// The public transport-option types re-exported from `types.ts` extend types from
// `@types/nodemailer` (e.g. `SMTPTransportOptions extends SMTPTransport.Options`), and
// nodemailer@9 ships no types of its own. `@types/nodemailer` is therefore part of the
// plugin's PUBLISHED `.d.ts` surface. If it is only a devDependency, consumer projects
// don't receive it, so `SMTPTransportOptions` loses `host`/`port`/... and their config
// fails to compile (TS2353) — the reported bug. It must be a runtime `dependency`.
//
// Note: this can only be guarded at the packaging level. A type-level test (see
// `transport-options.spec-d.ts`) passes regardless of the dev/prod classification because
// `@types/nodemailer` is always resolvable inside this repo; the failure only manifests in
// an external consumer's install. This test is the invariant that actually flips between
// the buggy and fixed states.
describe('email-plugin published type dependencies (#4920)', () => {
    const packageRoot = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    const typesLeakNodemailer = fs
        .readFileSync(path.join(__dirname, 'types.ts'), 'utf-8')
        .includes("from 'nodemailer/");

    it('re-exports nodemailer types from its public API', () => {
        // Guards the premise below: if a future refactor inlines these types, this fails
        // and the runtime-dependency requirement should be revisited rather than assumed.
        expect(typesLeakNodemailer).toBe(true);
    });

    it('declares @types/nodemailer as a runtime dependency, not a devDependency', () => {
        expect(pkg.dependencies?.['@types/nodemailer']).toBeTruthy();
        expect(pkg.devDependencies?.['@types/nodemailer']).toBeUndefined();
    });
});
