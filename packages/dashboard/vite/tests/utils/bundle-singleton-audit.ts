import react from '@vitejs/plugin-react';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, RollupOutput } from 'vite';

import { dashboardBundleExternals, isExternalId, runtimePeers } from '../../lib-externals.js';
import { viteConfigPlugin } from '../../vite-plugin-config.js';

/**
 * A dependency that must be a single module instance across the dashboard app
 * and consumer extension code. Duplicating any of these across the pre-built
 * bundle / extension-build boundary breaks it at runtime — see issue #4919.
 */
export interface SingletonCandidate {
    /** npm package name */
    pkg: string;
    /** why a duplicated instance is a correctness bug */
    reason: string;
    /** the runtime symptom when it IS duplicated */
    symptom: string;
    /**
     * A string that only appears in this library's own code. Because the
     * dashboard ships a PRE-BUILT bundle, the library is already inlined into
     * `dist/bundle`'s chunks — its `node_modules` path is gone — so we detect
     * its presence by this internal marker rather than by module path.
     */
    marker: string;
    /**
     * Named exports of `@vendure/dashboard` that pull the package into an
     * extension's module graph. Imported by the synthetic extension so the
     * audit exercises the real public-API reachability path.
     */
    publicImports: string[];
}

/**
 * The libraries most likely to break under the pre-built bundle. Each owns a
 * React Context or a module-level singleton and is reachable through the
 * dashboard's public API.
 */
export const SINGLETON_CANDIDATES: SingletonCandidate[] = [
    {
        pkg: '@tanstack/react-query',
        reason: 'React Context (QueryClientContext)',
        symptom: '"No QueryClient set, use QueryClientProvider to set one"',
        marker: 'No QueryClient set',
        publicImports: ['useQuery', 'useMutation', 'useSuspenseQuery'],
    },
    {
        pkg: 'react-hook-form',
        reason: 'React Context (FormProvider)',
        symptom: 'useFormContext() returns null → form inputs throw / lose state',
        marker: '_proxyFormState',
        publicImports: ['useForm', 'useFormContext', 'Controller'],
    },
    {
        pkg: '@tanstack/react-router',
        reason: 'React Context (RouterContext)',
        symptom: 'router hooks throw outside the RouterProvider they can see',
        marker: 'trimPathRight',
        publicImports: ['useNavigate', 'Link'],
    },
    {
        pkg: 'sonner',
        reason: 'module-level toast observer singleton',
        symptom: 'toast() notifies a different observer than <Toaster/> → toasts silently never appear',
        marker: 'data-sonner-toaster',
        publicImports: ['toast'],
    },
];

export interface CandidateAudit {
    candidate: SingletonCandidate;
    /** externalised in the dashboard bundle build (informational) */
    externalInLib: boolean;
    /** the library's code is frozen into the shipped `dist/bundle` */
    frozenInBundle: boolean;
    /** the library's code is physically re-bundled by an extension build */
    inExtensionBuild: boolean;
    /** two live copies at runtime: present in the bundle AND in the extension */
    duplicated: boolean;
}

export interface BundleSingletonAudit {
    results: CandidateAudit[];
    offenders: CandidateAudit[];
}

/**
 * Reports which singleton-sensitive libraries would end up duplicated at
 * runtime under the experimental pre-built bundle.
 *
 * Two independent, empirical signals are combined:
 *  - `frozenInBundle`: the marker is found by scanning the shipped `dist/bundle`.
 *  - `inExtensionBuild`: the marker is found in the output of a synthetic
 *    extension built against `dist/bundle/lib.js` exactly as a consumer's Vite
 *    does in bundle mode.
 *
 * `packageRoot` must contain a `dist/bundle` that is fresh relative to the
 * current `lib-externals.ts` (the caller runs `build:lib` first).
 */
export async function auditBundleSingletons(opts: {
    packageRoot: string;
    candidates?: SingletonCandidate[];
}): Promise<BundleSingletonAudit> {
    const candidates = opts.candidates ?? SINGLETON_CANDIDATES;
    const bundleDir = path.join(opts.packageRoot, 'dist', 'bundle');

    const bundleCode = await concatJsFiles(bundleDir);
    const extensionCode = await buildExtensionCode(opts.packageRoot, candidates);

    const results: CandidateAudit[] = candidates.map(candidate => {
        const externalInLib = isExternalId(candidate.pkg, dashboardBundleExternals);
        const frozenInBundle = bundleCode.includes(candidate.marker);
        const inExtensionBuild = extensionCode.includes(candidate.marker);
        return {
            candidate,
            externalInLib,
            frozenInBundle,
            inExtensionBuild,
            duplicated: frozenInBundle && inExtensionBuild,
        };
    });

    return { results, offenders: results.filter(r => r.duplicated) };
}

/**
 * Builds a one-file extension that imports the candidates' public-API surface
 * from `@vendure/dashboard` (aliased to the pre-built `lib.js`, exactly as the
 * consumer's Vite does in bundle mode) and returns its emitted code.
 */
async function buildExtensionCode(packageRoot: string, candidates: SingletonCandidate[]): Promise<string> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vdb-singleton-audit-'));
    try {
        const imports = [...new Set(candidates.flatMap(c => c.publicImports))];
        const entry = path.join(tmpDir, 'extension.tsx');
        // Reference every import so tree-shaking cannot drop the libraries they
        // transitively pull in — we want worst-case reachability.
        await writeFile(
            entry,
            `import { ${imports.join(', ')} } from '@vendure/dashboard';\n` +
                `export const __used = [${imports.join(', ')}];\n`,
        );

        const result = (await build({
            configFile: false,
            logLevel: 'silent',
            root: tmpDir,
            plugins: [
                react(),
                // Provides the `@vendure/dashboard` → dist/bundle/lib.js alias
                // that a consumer project uses in experimental-bundle mode.
                viteConfigPlugin({ packageRoot, useExperimentalBundle: true }),
            ],
            build: {
                write: false,
                minify: false,
                lib: { entry, formats: ['es'], fileName: 'extension' },
                // Extensions bundle their own copy of everything they import
                // except the true runtime peers, which the consumer provides.
                rollupOptions: { external: runtimePeers },
            },
        })) as RollupOutput | RollupOutput[];

        const outputs = Array.isArray(result) ? result : [result];
        return outputs
            .flatMap(o => o.output)
            .map(chunk => (chunk.type === 'chunk' ? chunk.code : ''))
            .join('\n');
    } finally {
        await rm(tmpDir, { recursive: true, force: true });
    }
}

async function concatJsFiles(dir: string): Promise<string> {
    const files = await collectJsFiles(dir);
    const contents = await Promise.all(files.map(f => readFile(f, 'utf8')));
    return contents.join('\n');
}

async function collectJsFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectJsFiles(full)));
        } else if (entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
    return files;
}
