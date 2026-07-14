import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

import { auditBundleSingletons, BundleSingletonAudit } from './utils/bundle-singleton-audit.js';

const execFileAsync = promisify(execFile);

// Dashboard package root — this file lives at <root>/vite/tests/.
const packageRoot = join(__dirname, '..', '..');

/**
 * Guards the singleton-sharing contract of the experimental pre-built bundle
 * (`useExperimentalBundle`). A context/singleton library frozen into the bundle
 * AND re-bundled by a consumer's extension build exists as two live module
 * instances at runtime, which breaks React Context identity — the "No
 * QueryClient set" family of bugs. See issue #4919 and vite/lib-externals.ts.
 */
describe('bundle singleton duplication', () => {
    let audit: BundleSingletonAudit;

    beforeAll(async () => {
        // Rebuild the bundle so the audit reflects the CURRENT externals list.
        await execFileAsync('npm', ['run', 'build:lib'], { cwd: packageRoot });
        audit = await auditBundleSingletons({ packageRoot });
        await writeAuditReport(audit);
        // eslint-disable-next-line no-console
        console.log('\n' + formatAuditTable(audit) + '\n');
    }, 180_000);

    it('does not duplicate any singleton-sensitive library across the bundle/extension boundary', () => {
        const offenders = audit.offenders.map(o => `${o.candidate.pkg} — ${o.candidate.symptom}`);
        expect(offenders, `Duplicated singleton libraries:\n  ${offenders.join('\n  ')}`).toEqual([]);
    });

    it('detects every still-bundled library in the extension build (guards against a stale marker)', () => {
        // A library that is NOT externalised is frozen into the bundle and must
        // be detectable in the extension build — otherwise its marker is stale
        // and the duplication check would silently pass. (Externalised libraries
        // may legitimately be tree-shaken out, so they are exempt.)
        const undetected = audit.results
            .filter(r => !r.externalInLib && !r.inExtensionBuild)
            .map(r => r.candidate.pkg);
        expect(undetected, `Stale marker — not detected in the extension build: ${undetected.join(', ')}`).toEqual(
            [],
        );
    });
});

function formatAuditTable(audit: BundleSingletonAudit): string {
    const header = 'BUNDLE SINGLETON AUDIT (issue #4919)';
    const rows = audit.results.map(r => {
        const verdict = r.duplicated ? 'DUPLICATED ✗' : r.frozenInBundle ? 'still-frozen' : 'shared ✓';
        return [
            r.candidate.pkg.padEnd(24),
            `frozenInBundle:${String(r.frozenInBundle).padEnd(5)}`,
            `inExtension:${String(r.inExtensionBuild).padEnd(5)}`,
            verdict,
        ].join('  ');
    });
    return [header, '='.repeat(header.length), ...rows].join('\n');
}

async function writeAuditReport(audit: BundleSingletonAudit): Promise<void> {
    const outDir = join(packageRoot, 'dist');
    await mkdir(outDir, { recursive: true });
    await writeFile(
        join(outDir, 'bundle-singleton-audit.json'),
        JSON.stringify(
            {
                offenders: audit.offenders.map(o => o.candidate.pkg),
                results: audit.results.map(r => ({
                    pkg: r.candidate.pkg,
                    externalInLib: r.externalInLib,
                    frozenInBundle: r.frozenInBundle,
                    inExtensionBuild: r.inExtensionBuild,
                    duplicated: r.duplicated,
                    symptom: r.candidate.symptom,
                })),
            },
            null,
            2,
        ),
    );
}
