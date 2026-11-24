import { describe, expect, it } from 'vitest';

import {
    buildProgram,
    CREATE_OPTIONS,
    isInteractive,
    parseAgents,
    parseFeatures,
    parseStorefront,
    resolveCreateOptions,
    resolveLogLevel,
} from './options.js';
import { detectPackageManager } from './package-manager.js';
import { PresetDescription } from './presets.js';
import { ScenarioDefinition } from './registries.js';

const presets: PresetDescription[] = [
    { name: 'uk', description: 'UK', options: {} },
    {
        name: 'single-country',
        description: 'One country',
        options: {
            country: { description: 'The country', required: true },
            currency: { description: 'The currency', required: true },
        },
    },
];

const scenarios: ScenarioDefinition[] = [
    {
        name: 'demo',
        description: 'A demo',
        package: '@example/scenario-demo',
        version: '1.0.0',
        preset: { name: 'uk', options: {} },
    },
];

const context = { cwd: '/work', userAgent: undefined, presets, scenarios };

function codeOf(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (e) {
        return (e as { code?: string }).code;
    }
    return undefined;
}

describe('option table', () => {
    it('gives every flag that replaces a prompt a row', () => {
        const keys = CREATE_OPTIONS.map(option => option.key);
        for (const key of [
            'storefront',
            'preset',
            'scenario',
            'features',
            'packageManager',
            'agents',
            'yes',
            'json',
        ]) {
            expect(keys).toContain(key);
        }
    });

    it('has no --ci, --use-npm or database flags', () => {
        const help = buildProgram('0.0.0').helpInformation();
        expect(help).not.toMatch(/--ci\b|--use-npm|--db\b|--with-storefront/);
        expect(help).toContain('--package-manager');
    });
});

describe('detectPackageManager()', () => {
    it('reads the manager from npm_config_user_agent and falls back to npm', () => {
        expect(detectPackageManager('pnpm/10.0.0 npm/? node/v22.12.0 linux x64')).toBe('pnpm');
        expect(detectPackageManager('bun/1.4.4 npm/? node/v24.3.0 linux x64')).toBe('bun');
        expect(detectPackageManager('yarn/4.5.0 npm/? node/v22.12.0 darwin arm64')).toBe('yarn');
        expect(detectPackageManager('npm/10.9.0 node/v22.12.0 linux x64')).toBe('npm');
        expect(detectPackageManager(undefined)).toBe('npm');
    });
});

describe('flag parsing', () => {
    it('parses storefronts, with none for no storefront', () => {
        expect(parseStorefront('NextJS')).toBe('nextjs');
        expect(parseStorefront('none')).toBeNull();
        expect(codeOf(() => parseStorefront('gatsby'))).toBe('create.storefront-unknown');
    });

    it('parses agents in the table order, with none for no agents', () => {
        expect(parseAgents('codex, claude,codex')).toEqual(['claude', 'codex']);
        expect(parseAgents('none')).toEqual([]);
        expect(codeOf(() => parseAgents('claude,emacs'))).toBe('create.agent-unknown');
    });

    it('parses feature lists', () => {
        expect(parseFeatures('b2b, B2B')).toEqual(['b2b']);
        expect(parseFeatures('none')).toEqual([]);
    });

    it('refuses an unknown log level', () => {
        expect(resolveLogLevel({ verbose: true })).toBe('verbose');
        expect(codeOf(() => resolveLogLevel({ logLevel: 'loud' }))).toBe('create.log-level-unknown');
    });
});

describe('isInteractive()', () => {
    const tty = { stdin: { isTTY: true }, stdout: { isTTY: true } };

    it('prompts only on a terminal without --yes or --json', () => {
        expect(isInteractive({}, tty)).toBe(true);
        expect(isInteractive({ yes: true }, tty)).toBe(false);
        expect(isInteractive({ json: true }, tty)).toBe(false);
        expect(isInteractive({}, { stdin: { isTTY: true }, stdout: {} })).toBe(false);
        expect(isInteractive({}, { stdin: {}, stdout: { isTTY: true } })).toBe(false);
    });
});

describe('resolveCreateOptions()', () => {
    it('uses the defaults that --yes accepts', () => {
        expect(
            resolveCreateOptions('my-shop', { yes: true }, { ...context, userAgent: 'bun/1.4.4 node' }),
        ).toEqual({
            projectDir: '/work/my-shop',
            name: 'my-shop',
            packageManager: 'bun',
            storefront: null,
            preset: null,
            scenario: null,
            features: [],
            agents: ['claude', 'cursor', 'vscode', 'codex'],
            install: true,
            git: true,
        });
    });

    it('lets --package-manager override the detected manager', () => {
        const options = resolveCreateOptions(
            'a',
            { packageManager: 'PNPM' },
            { ...context, userAgent: 'bun/1' },
        );
        expect(options.packageManager).toBe('pnpm');
        expect(codeOf(() => resolveCreateOptions('a', { packageManager: 'deno' }, context))).toBe(
            'create.package-manager-unknown',
        );
    });

    it('needs a project directory', () => {
        expect(codeOf(() => resolveCreateOptions(undefined, {}, context))).toBe(
            'create.project-directory-missing',
        );
    });

    it('validates the preset and its options', () => {
        expect(
            resolveCreateOptions('a', { preset: 'single-country', country: 'nz', currency: 'nzd' }, context)
                .preset,
        ).toEqual({ name: 'single-country', options: { country: 'NZ', currency: 'NZD' } });
        expect(codeOf(() => resolveCreateOptions('a', { preset: 'mars' }, context))).toBe(
            'create.preset-unknown',
        );
        expect(
            codeOf(() => resolveCreateOptions('a', { preset: 'single-country', country: 'NZ' }, context)),
        ).toBe('create.preset-option-missing');
        expect(codeOf(() => resolveCreateOptions('a', { preset: 'uk', country: 'GB' }, context))).toBe(
            'create.preset-invalid-option',
        );
        expect(codeOf(() => resolveCreateOptions('a', { country: 'GB' }, context))).toBe(
            'create.preset-option-without-preset',
        );
    });

    it("records a scenario's own preset when --preset is left out", () => {
        const options = resolveCreateOptions('a', { scenario: 'demo' }, context);
        expect(options.scenario).toEqual({
            name: 'demo',
            package: '@example/scenario-demo',
            version: '1.0.0',
        });
        expect(options.preset).toEqual({ name: 'uk', options: {} });
    });

    it("accepts a --preset that names the scenario's preset", () => {
        expect(resolveCreateOptions('a', { scenario: 'demo', preset: 'uk' }, context).preset).toEqual({
            name: 'uk',
            options: {},
        });
    });

    it('refuses any other preset with a scenario', () => {
        expect(
            codeOf(() =>
                resolveCreateOptions(
                    'a',
                    { scenario: 'demo', preset: 'single-country', country: 'NZ', currency: 'NZD' },
                    context,
                ),
            ),
        ).toBe('create.preset-conflicts-with-scenario');
    });

    it('refuses scenarios and feature sets the registries do not have', () => {
        expect(codeOf(() => resolveCreateOptions('a', { scenario: 'nope' }, context))).toBe(
            'create.scenario-unknown',
        );
        expect(codeOf(() => resolveCreateOptions('a', { features: 'b2b' }, context))).toBe(
            'create.feature-unknown',
        );
        expect(resolveCreateOptions('a', { scenario: 'none', features: 'none' }, context)).toMatchObject({
            scenario: null,
            features: [],
        });
    });

    it('turns --no-install and --no-git off', () => {
        expect(resolveCreateOptions('a', { install: false, git: false }, context)).toMatchObject({
            install: false,
            git: false,
        });
    });
});
