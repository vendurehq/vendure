import type { CreateRecordPreset } from '@vendure/common/lib/create-record';
import { Command } from 'commander';
import path from 'node:path';

import { CreateError } from './errors.js';
import { detectPackageManager, PACKAGE_MANAGERS, parsePackageManager } from './package-manager.js';
import { PresetDescription, validatePreset } from './presets.js';
import {
    FEATURE_SETS,
    FeatureSetDefinition,
    findFeatureSets,
    findScenario,
    resolvePresetAndScenario,
    ScenarioDefinition,
    SCENARIOS,
} from './registries.js';
import { STOREFRONT_STARTERS, StorefrontId } from './storefront-starters.js';
import { AGENT_CLIENTS, AgentClient, CliLogLevel, CreateOptions } from './types.js';

/**
 * The raw values of the flags, as commander parses them. Every choice is a string here, and
 * {@link resolveCreateOptions} turns them into a {@link CreateOptions}.
 */
export interface RawCreateFlags {
    storefront?: string;
    preset?: string;
    country?: string;
    currency?: string;
    scenario?: string;
    features?: string;
    packageManager?: string;
    agents?: string;
    yes?: boolean;
    json?: boolean;
    install?: boolean;
    git?: boolean;
    logLevel?: string;
    verbose?: boolean;
}

/**
 * One row per flag. The prompts in `prompts.ts`, the flags and `--help` all read their
 * descriptions from here.
 */
export interface CreateOption {
    key: keyof RawCreateFlags;
    flags: string;
    description: string;
}

/** The options of a preset that are also flags. They match `vendure seed`'s flags. */
export const PRESET_OPTION_FLAGS = ['country', 'currency'] as const;

export const CREATE_OPTIONS: readonly CreateOption[] = [
    {
        key: 'storefront',
        flags: '--storefront <storefront>',
        description: `The storefront starter to add: ${STOREFRONT_STARTERS.map(s => s.id).join(', ')} or none (default none)`,
    },
    {
        key: 'preset',
        flags: '--preset <name>',
        description:
            'The base-data preset the first `vendure dev` seeds, for example uk. A scenario sets its own preset',
    },
    {
        key: 'country',
        flags: '--country <code>',
        description: 'The country option of the preset, as an ISO 3166-1 alpha-2 code, for example NZ',
    },
    {
        key: 'currency',
        flags: '--currency <code>',
        description: 'The currency option of the preset, as an ISO 4217 code, for example NZD',
    },
    {
        key: 'scenario',
        flags: '--scenario <name>',
        description: 'The demo scenario the first `vendure dev` seeds, or none (default none)',
    },
    {
        key: 'features',
        flags: '--features <sets>',
        description: 'A comma-separated list of feature sets to install',
    },
    {
        key: 'packageManager',
        flags: '--package-manager <name>',
        description: `The package manager: ${PACKAGE_MANAGERS.join(', ')} (default: the one that ran create)`,
    },
    {
        key: 'agents',
        flags: '--agents <clients>',
        description: `A comma-separated list of the agent clients to write files for: ${AGENT_CLIENTS.join(', ')}, or none (default all)`,
    },
    { key: 'yes', flags: '-y, --yes', description: 'Accept every default and never prompt' },
    {
        key: 'json',
        flags: '--json',
        description: 'Print one JSON result on stdout, and everything else on stderr. Never prompts',
    },
    { key: 'install', flags: '--no-install', description: 'Write the files without installing dependencies' },
    { key: 'git', flags: '--no-git', description: 'Do not initialise a git repository' },
    {
        key: 'logLevel',
        flags: '--log-level <logLevel>',
        description: "Log level, either 'silent', 'info', or 'verbose'",
    },
    { key: 'verbose', flags: '--verbose', description: 'Alias for --log-level verbose' },
];

export function buildProgram(version: string): Command {
    const program = new Command('@vendure/create')
        .version(version)
        .argument('[project-directory]', 'The directory to create the project in')
        .usage('<project-directory> [options]')
        .helpOption('-h, --help', 'Show this help');
    for (const option of CREATE_OPTIONS) {
        program.option(option.flags, option.description);
    }
    return program;
}

export function resolveLogLevel(flags: RawCreateFlags): CliLogLevel {
    if (flags.verbose) {
        return 'verbose';
    }
    const level = flags.logLevel?.toLowerCase() ?? 'info';
    if (level !== 'silent' && level !== 'info' && level !== 'verbose') {
        throw new CreateError(
            'create.log-level-unknown',
            `Unknown log level "${flags.logLevel ?? ''}".`,
            'Use silent, info or verbose.',
        );
    }
    return level;
}

/** Prompts appear only when both stdin and stdout are terminals, and neither --yes nor --json is set. */
export function isInteractive(
    flags: RawCreateFlags,
    streams: { stdin: { isTTY?: boolean }; stdout: { isTTY?: boolean } } = process,
): boolean {
    return !flags.yes && !flags.json && !!streams.stdin.isTTY && !!streams.stdout.isTTY;
}

export function parseStorefront(value: string): StorefrontId | null {
    const id = value.toLowerCase();
    if (id === 'none') {
        return null;
    }
    const storefront = STOREFRONT_STARTERS.find(s => s.id === id);
    if (!storefront) {
        throw new CreateError(
            'create.storefront-unknown',
            `Unknown storefront "${value}".`,
            `Use one of ${STOREFRONT_STARTERS.map(s => s.id).join(', ')}, or none.`,
        );
    }
    return storefront.id;
}

export function parseAgents(value: string): AgentClient[] {
    const names = splitList(value);
    if (names.length === 1 && names[0] === 'none') {
        return [];
    }
    for (const name of names) {
        if (!(AGENT_CLIENTS as readonly string[]).includes(name)) {
            throw new CreateError(
                'create.agent-unknown',
                `Unknown agent client "${name}".`,
                `Use one or more of ${AGENT_CLIENTS.join(', ')}, or none.`,
            );
        }
    }
    // In the table's order, without duplicates, so the record does not depend on how they were typed.
    return AGENT_CLIENTS.filter(client => names.includes(client));
}

export function parseFeatures(value: string): string[] {
    const names = splitList(value);
    return names.length === 1 && names[0] === 'none' ? [] : [...new Set(names)];
}

function splitList(value: string): string[] {
    return value
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

/** The preset from `--preset` and its option flags, or `null`. */
export function presetFromFlags(flags: RawCreateFlags): CreateRecordPreset | null {
    const options: Record<string, string> = {};
    for (const key of PRESET_OPTION_FLAGS) {
        const value = flags[key];
        if (value !== undefined) {
            options[key] = value.toUpperCase();
        }
    }
    if (!flags.preset) {
        if (Object.keys(options).length) {
            throw new CreateError(
                'create.preset-option-without-preset',
                `${Object.keys(options)
                    .map(o => `--${o}`)
                    .join(' and ')} need --preset.`,
                'For example: --preset single-country --country NZ --currency NZD',
            );
        }
        return null;
    }
    return { name: flags.preset.toLowerCase(), options };
}

export interface ResolveContext {
    /** The working directory the project directory is resolved against. */
    cwd: string;
    /** The `npm_config_user_agent` of the process, for the package manager default. */
    userAgent: string | undefined;
    presets: readonly PresetDescription[];
    scenarios?: readonly ScenarioDefinition[];
    featureSets?: readonly FeatureSetDefinition[];
}

/**
 * Turns the flags, and any prompt answers merged into them, into the options create runs with.
 * Every check happens here, so an invalid choice fails before a file is written.
 */
export function resolveCreateOptions(
    projectDirectory: string | undefined,
    flags: RawCreateFlags,
    context: ResolveContext,
): CreateOptions {
    if (!projectDirectory) {
        throw new CreateError(
            'create.project-directory-missing',
            'No project directory was given.',
            'For example: npx @vendure/create my-shop',
        );
    }
    const projectDir = path.resolve(context.cwd, projectDirectory);
    const scenarioName = flags.scenario?.toLowerCase();
    const scenario =
        scenarioName && scenarioName !== 'none'
            ? findScenario(scenarioName, context.scenarios ?? SCENARIOS)
            : null;
    const givenPreset = presetFromFlags(flags);
    const resolved = resolvePresetAndScenario(givenPreset, scenario);
    const preset = resolved.preset ? validatePreset(resolved.preset, context.presets) : null;
    const features = flags.features ? parseFeatures(flags.features) : [];
    findFeatureSets(features, context.featureSets ?? FEATURE_SETS);
    return {
        projectDir,
        name: path.basename(projectDir),
        packageManager: flags.packageManager
            ? parsePackageManager(flags.packageManager)
            : detectPackageManager(context.userAgent),
        storefront: flags.storefront ? parseStorefront(flags.storefront) : null,
        preset,
        scenario: resolved.scenario,
        features,
        agents: flags.agents !== undefined ? parseAgents(flags.agents) : [...AGENT_CLIENTS],
        install: flags.install !== false,
        git: flags.git !== false,
    };
}
