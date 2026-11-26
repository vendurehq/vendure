import {
    CommandContext,
    CommandErrorDefinition,
    CommandRunResult,
    ErrorResult,
    fail,
    failed,
    incomplete,
    IncompleteResult,
    isErrorResult,
} from '@vendure/common/lib/command';
import {
    CREATE_RECORD_PATH,
    CreateRecord,
    CreateRecordScenario,
    parseCreateRecord,
} from '@vendure/common/lib/create-record';
import type { VendureConfig } from '@vendure/core';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { configResolverFailed } from '../../shared/config-resolver.errors.js';
import {
    ConfigResolverFailedError,
    loadSourceConfig,
    resolveProjectConfig,
    withUnreadableManifests,
} from '../../shared/load-project-config.js';
import { loadVendureConfigFromPath } from '../../shared/load-vendure-config-file.js';
import { requireProjectCore, withCoreRunningInCli } from '../../shared/project-core.js';
import { findVendureProjectRoot } from '../../shared/project-validation.js';

import { readSeedState, SeedState } from './seed-state.js';
import {
    seedConfigUnreadable,
    seedConflictingOptions,
    seedCoreUnsupported,
    seedCreateRecordInvalid,
    seedDatabaseUnreadable,
    seedErrorsByCode,
    seedFailed,
} from './seed.errors.js';
import { SeedInput, SeedOutput, SeedStep } from './seed.schema.js';

type ProjectCore = ReturnType<typeof requireProjectCore>;

export async function run(input: SeedInput, ctx: CommandContext): Promise<CommandRunResult<SeedOutput>> {
    if (input.firstRun) {
        if (input.preset || input.country || input.currency) {
            return fail(seedConflictingOptions, {
                message:
                    '--first-run applies what .vendure/create.json records, so it takes no --preset, --country or --currency.',
            });
        }
        return runFirstRun(input, ctx);
    }
    const core = requireProjectCore(ctx.cwd);
    const unsupported = checkCoreSupportsSeeding(core);
    if (unsupported) {
        return unsupported;
    }
    if (!input.preset) {
        return { presets: core.listPresets() };
    }
    const options = presetOptions(input);
    try {
        core.validatePresetOptions(input.preset, options);
    } catch (e) {
        return seedErrorResult(e, core);
    }
    const config = await loadSeedConfig(ctx, input.config);
    if (isErrorResult(config)) {
        return config;
    }
    ctx.progress(`Applying the ${input.preset} preset`);
    return withApp(core, config, async app => {
        const result = await core.applyPreset(app, input.preset as string, options);
        result.notices.forEach(notice => ctx.notice('info', notice));
        return { preset: { status: 'applied', name: result.preset, created: result.created } };
    });
}

/**
 * Applies the preset and the scenario that `.vendure/create.json` records, once per database. The
 * seed sentinels are read over a plain database connection first, so a database that is already
 * seeded returns without bootstrapping Vendure.
 */
async function runFirstRun(input: SeedInput, ctx: CommandContext): Promise<CommandRunResult<SeedOutput>> {
    const projectRoot = findVendureProjectRoot(ctx.cwd) ?? ctx.cwd;
    const record = await readCreateRecord(projectRoot, ctx);
    if (isErrorResult(record)) {
        return record;
    }
    if (!record || (!record.preset && !record.scenario)) {
        const reason = record
            ? 'create.json records no preset and no scenario'
            : `there is no ${CREATE_RECORD_PATH}`;
        return { preset: { status: 'skipped', reason }, scenario: { status: 'skipped', reason } };
    }
    const config = await loadSeedConfig(ctx, input.config);
    if (isErrorResult(config)) {
        return config;
    }
    let state: SeedState;
    try {
        state = await readSeedState(config, ctx.cwd);
    } catch (e) {
        return fail(seedDatabaseUnreadable, { message: errorMessage(e) });
    }

    let presetStep = planPreset(record, state);
    let scenarioStep = planScenario(record, state, presetStep);
    if (presetStep.status !== 'pending' && scenarioStep.status !== 'pending') {
        return { preset: presetStep, scenario: scenarioStep };
    }

    const core = requireProjectCore(ctx.cwd);
    const unsupported = checkCoreSupportsSeeding(core);
    if (unsupported) {
        return unsupported;
    }
    let anyFailed = false;
    const outcome = await withApp(core, config, async app => {
        if (presetStep.status === 'pending' && record.preset) {
            ctx.progress(`Applying the ${record.preset.name} preset`);
            try {
                const result = await core.applyPreset(app, record.preset.name, record.preset.options);
                result.notices.forEach(notice => ctx.notice('info', notice));
                presetStep = { status: 'applied', name: result.preset, created: result.created };
            } catch (e) {
                // The database filled up since the sentinels were read, without a preset.
                if (
                    core.isSeedError(e) &&
                    e.vendureCode === 'core.preset-database-not-empty' &&
                    !e.details.appliedPreset
                ) {
                    presetStep = { status: 'skipped', name: record.preset.name, reason: NOT_EMPTY_REASON };
                } else {
                    presetStep = failedStep(record.preset.name, e, core);
                    anyFailed = true;
                }
            }
            scenarioStep = planScenario(record, state, presetStep);
        }
        if (scenarioStep.status === 'pending' && record.scenario) {
            ctx.progress(`Seeding the ${record.scenario.name} scenario`);
            scenarioStep = await seedScenario(core, app, record.scenario, projectRoot);
            anyFailed = anyFailed || scenarioStep.status === 'failed';
        }
        return {};
    });
    if (isErrorResult(outcome)) {
        // Vendure did not start, or failed outside a seed: every step that was still to run failed.
        // The callback catches every seed error, so the outcome is never incomplete here.
        const { code } = outcome;
        const message =
            (outcome.details as { message?: string } | undefined)?.message ??
            'Vendure could not be started to seed the database';
        const failPending = (step: PlannedStep): PlannedStep =>
            step.status === 'pending'
                ? { status: 'failed', name: step.name, reason: message, error: { code, message } }
                : step;
        presetStep = failPending(presetStep);
        scenarioStep = failPending(scenarioStep);
        anyFailed = true;
    }
    const output = { preset: presetStep as SeedStep, scenario: scenarioStep as SeedStep };
    return anyFailed ? failed(output) : output;
}

const DEFAULT_CONFIG_FILES = ['src/vendure-config.ts', 'vendure-config.ts'];

const NOT_EMPTY_REASON =
    'The database has setup data and no vendure.seed.preset sentinel, so it was set up another way. It is never seeded.';

type PlannedStep = SeedStep | { status: 'pending'; name: string };

function planPreset(record: CreateRecord, state: SeedState): PlannedStep {
    if (!record.preset) {
        return { status: 'skipped', reason: 'create.json records no preset' };
    }
    const { name } = record.preset;
    if (state.preset) {
        return state.preset.name === name
            ? { status: 'already-applied', name }
            : {
                  status: 'skipped',
                  name,
                  reason: `The database was seeded with the "${state.preset.name}" preset`,
              };
    }
    if (!state.empty) {
        return { status: 'skipped', name, reason: NOT_EMPTY_REASON };
    }
    return { status: 'pending', name };
}

function planScenario(record: CreateRecord, state: SeedState, presetStep: PlannedStep): PlannedStep {
    if (!record.scenario) {
        return { status: 'skipped', reason: 'create.json records no scenario' };
    }
    const { name } = record.scenario;
    if (state.scenario) {
        return state.scenario.name === name
            ? { status: 'already-applied', name }
            : {
                  status: 'skipped',
                  name,
                  reason: `The database was seeded with the "${state.scenario.name}" scenario`,
              };
    }
    const presetApplied = presetStep.status === 'applied' || presetStep.status === 'already-applied';
    if (!record.preset || !presetApplied) {
        return {
            status: 'skipped',
            name,
            reason: 'The scenario is seeded only after the preset it builds on was applied to this database',
        };
    }
    return { status: 'pending', name };
}

async function seedScenario(
    core: ProjectCore,
    app: Awaited<ReturnType<ProjectCore['bootstrapWorker']>>['app'],
    reference: CreateRecordScenario,
    projectRoot: string,
): Promise<SeedStep> {
    try {
        const pack = core.loadScenarioPack(reference, projectRoot);
        await core.seedScenario(app, reference, pack);
        return { status: 'applied', name: reference.name };
    } catch (e) {
        return failedStep(reference.name, e, core);
    }
}

function failedStep(name: string, e: unknown, core: ProjectCore): SeedStep {
    return {
        status: 'failed',
        name,
        reason: errorMessage(e),
        error: { code: core.isSeedError(e) ? e.vendureCode : seedFailed.code, message: errorMessage(e) },
    };
}

async function readCreateRecord(
    projectRoot: string,
    ctx: CommandContext,
): Promise<CreateRecord | undefined | ErrorResult> {
    let text: string;
    try {
        text = await readFile(path.join(projectRoot, CREATE_RECORD_PATH), 'utf-8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        return fail(seedCreateRecordInvalid, { message: errorMessage(e) });
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (e) {
        return fail(seedCreateRecordInvalid, { message: `it is not valid JSON: ${errorMessage(e)}` });
    }
    const parsed = parseCreateRecord(json);
    if (parsed.result === 'unsupported-version') {
        ctx.notice(
            'warning',
            `${CREATE_RECORD_PATH} has version ${String(parsed.version)}, which this CLI does not know. Nothing was seeded. Update @vendure/cli.`,
        );
        return undefined;
    }
    if (parsed.result === 'invalid') {
        return fail(seedCreateRecordInvalid, { field: parsed.field, message: parsed.message });
    }
    return parsed.record;
}

/**
 * Loads the project's Vendure config. The config resolvers of the enabled packages come first.
 * Then a config at `--config`, `src/vendure-config.ts` or `vendure-config.ts` is required directly,
 * which is seconds faster than finding it by parsing the project, and matters because
 * `--first-run` runs on every `vendure dev` start.
 */
export async function loadSeedConfig(
    ctx: Pick<CommandContext, 'cwd' | 'signal'>,
    configFile?: string,
): Promise<VendureConfig | ErrorResult> {
    try {
        const projectRoot = findVendureProjectRoot(ctx.cwd) ?? ctx.cwd;
        const resolved = await resolveProjectConfig({
            cwd: ctx.cwd,
            projectDir: projectRoot,
            configFile,
            signal: ctx.signal,
        });
        if (resolved) {
            return resolved.config;
        }
        const candidates = configFile
            ? [path.resolve(ctx.cwd, configFile)]
            : DEFAULT_CONFIG_FILES.map(file => path.join(projectRoot, file));
        const configPath = candidates.find(candidate => existsSync(candidate));
        const config = configPath ? await loadVendureConfigFromPath(configPath) : undefined;
        if (config) {
            return config;
        }
        try {
            return (await loadSourceConfig({ configFile })).config;
        } catch (e) {
            throw withUnreadableManifests(e, { cwd: ctx.cwd, projectDir: projectRoot });
        }
    } catch (e) {
        // Thrown, so the host reports the command as cancelled.
        if (ctx.signal.aborted) {
            throw e;
        }
        if (e instanceof ConfigResolverFailedError) {
            return fail(configResolverFailed, e.details);
        }
        return fail(seedConfigUnreadable, { message: errorMessage(e) });
    }
}

/**
 * Bootstraps the project's Vendure as a worker, without its job queue, runs `fn`, and closes it.
 * Queued jobs, such as search index updates, run when the server starts.
 */
async function withApp(
    core: ProjectCore,
    config: VendureConfig,
    fn: (app: Awaited<ReturnType<ProjectCore['bootstrapWorker']>>['app']) => Promise<SeedOutput>,
): Promise<CommandRunResult<SeedOutput>> {
    let app: Awaited<ReturnType<ProjectCore['bootstrapWorker']>>['app'] | undefined;
    try {
        return await withCoreRunningInCli(async () => {
            // Only errors are logged, so the seed's own output is not buried in bootstrap logs.
            const logger = new core.DefaultLogger({ level: core.LogLevel.Error });
            app = (await core.bootstrapWorker({ ...config, logger })).app;
            return await fn(app);
        });
    } catch (e) {
        return seedErrorResult(e, core);
    } finally {
        await app?.close();
    }
}

function seedErrorResult(e: unknown, core: ProjectCore): ErrorResult | IncompleteResult {
    if (core.isSeedError(e)) {
        if (e.vendureCode === 'core.preset-invalid-option' && e.details.reason === 'is required') {
            return incomplete([
                {
                    kind: 'input',
                    field: e.details.option,
                    description: describeOption(core, e.details.preset, e.details.option),
                },
            ]);
        }
        // The project's core can be newer than this CLI, and throw a code the CLI does not know.
        const definition: CommandErrorDefinition | undefined =
            seedErrorsByCode[e.vendureCode as keyof typeof seedErrorsByCode];
        return definition
            ? fail(definition, { ...e.details, message: e.message })
            : fail(seedFailed, { message: e.message });
    }
    return fail(seedFailed, { message: errorMessage(e) });
}

function describeOption(core: ProjectCore, preset: string, option: string): string {
    return (
        core.getPreset(preset)?.options?.[option]?.description ??
        `The ${option} option of the ${preset} preset`
    );
}

function presetOptions(input: SeedInput): Record<string, string> {
    const options: Record<string, string> = {};
    if (input.country) {
        options.country = input.country;
    }
    if (input.currency) {
        options.currency = input.currency;
    }
    return options;
}

/**
 * The CLI loads the project's `@vendure/core`, which has the presets API from version 4.
 */
function checkCoreSupportsSeeding(core: ProjectCore): ErrorResult | undefined {
    const api = core as Partial<ProjectCore>;
    if (
        typeof api.applyPreset !== 'function' ||
        typeof api.seedScenario !== 'function' ||
        typeof api.isSeedError !== 'function'
    ) {
        return fail(seedCoreUnsupported, { version: core.VENDURE_VERSION ?? 'unknown' });
    }
    return undefined;
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
