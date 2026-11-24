import { CommandFix, defineError } from '@vendure/common/lib/command';

const listPresetsFix: CommandFix = {
    path: ['seed'],
    input: {},
    description: 'List the presets and their options',
};

/**
 * The errors `applyPreset()` and `seedScenario()` of `@vendure/core` throw, by code. Core builds the
 * message, so the details carry it.
 */
export const presetUnknown = defineError<{ message: string; name: string; available: string[] }>({
    code: 'core.preset-unknown',
    exit: 1,
    message: ({ message }) => message,
    fix: () => [listPresetsFix],
});

export const presetInvalidOption = defineError<{
    message: string;
    preset: string;
    option: string;
    reason: string;
}>({
    code: 'core.preset-invalid-option',
    exit: 1,
    message: ({ message }) => message,
    fix: () => [listPresetsFix],
});

export const presetDatabaseNotEmpty = defineError<{ message: string; appliedPreset?: string }>({
    code: 'core.preset-database-not-empty',
    exit: 1,
    message: ({ message }) => message,
});

export const scenarioInvalid = defineError<{ message: string; package: string; reason: string }>({
    code: 'core.scenario-invalid',
    exit: 1,
    message: ({ message }) => message,
});

export const scenarioPresetMismatch = defineError<{ message: string }>({
    code: 'core.scenario-preset-mismatch',
    exit: 1,
    message: ({ message }) => message,
});

export const scenarioAlreadySeeded = defineError<{ message: string }>({
    code: 'core.scenario-already-seeded',
    exit: 1,
    message: ({ message }) => message,
});

export const seedErrorsByCode = {
    [presetUnknown.code]: presetUnknown,
    [presetInvalidOption.code]: presetInvalidOption,
    [presetDatabaseNotEmpty.code]: presetDatabaseNotEmpty,
    [scenarioInvalid.code]: scenarioInvalid,
    [scenarioPresetMismatch.code]: scenarioPresetMismatch,
    [scenarioAlreadySeeded.code]: scenarioAlreadySeeded,
};

export const seedConflictingOptions = defineError<{ message: string }>({
    code: 'seed.conflicting-options',
    exit: 1,
    message: ({ message }) => message,
});

export const seedCoreUnsupported = defineError<{ version: string }>({
    code: 'seed.core-unsupported',
    exit: 1,
    message: ({ version }) =>
        `The project's @vendure/core (${version}) has no base-data presets. They need Vendure 4 or later.`,
});

export const seedConfigUnreadable = defineError<{ message: string }>({
    code: 'seed.config-unreadable',
    exit: 1,
    message: ({ message }) => `Could not load the Vendure config of the project: ${message}`,
});

export const seedDatabaseUnreadable = defineError<{ message: string }>({
    code: 'seed.database-unreadable',
    exit: 1,
    message: ({ message }) => `Could not read the seed state of the database: ${message}`,
    fix: () => [
        {
            path: ['migrate', 'run'],
            input: {},
            description: 'Run the migrations, so the database has its tables',
        },
    ],
});

export const seedCreateRecordInvalid = defineError<{ field?: string; message: string }>({
    code: 'seed.create-record-invalid',
    exit: 1,
    message: ({ message }) => `.vendure/create.json is not valid: ${message}`,
});

export const seedFailed = defineError<{ message: string }>({
    code: 'seed.failed',
    exit: 1,
    message: ({ message }) => `Seeding failed: ${message}`,
});

export const allSeedErrors = [
    ...Object.values(seedErrorsByCode),
    seedConflictingOptions,
    seedCoreUnsupported,
    seedConfigUnreadable,
    seedDatabaseUnreadable,
    seedCreateRecordInvalid,
    seedFailed,
];
