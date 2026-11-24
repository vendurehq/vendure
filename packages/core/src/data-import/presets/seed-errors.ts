import { defineError } from '@vendure/common/lib/command';

/**
 * @description
 * One way to fix a {@link SeedError}. `description` says what to do.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export interface SeedErrorFix {
    description: string;
}

/**
 * @description
 * What the database already holds when {@link applyPreset} refuses to run.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export interface PresetDatabaseNotEmptyDetails {
    countries: number;
    zones: number;
    taxRates: number;
    channels: number;
    /** The preset recorded in the `vendure.seed.preset` sentinel, if one was applied. */
    appliedPreset?: string;
}

/**
 * @description
 * An error thrown by {@link applyPreset} or {@link seedScenario}. It carries a namespaced code, such as
 * `core.preset-database-not-empty`, the details the message was built from, and fixes.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export class SeedError<Details = unknown> extends Error {
    readonly vendureCode: string;
    readonly details: Details;
    readonly fix: SeedErrorFix[];

    constructor(options: { code: string; message: string; details: Details; fix?: SeedErrorFix[] }) {
        super(options.message);
        this.name = 'SeedError';
        this.vendureCode = options.code;
        this.details = options.details;
        this.fix = options.fix ?? [];
    }
}

/**
 * @description
 * Whether `error` is a {@link SeedError}. It checks the shape, not the class, because the CLI can
 * load a different copy of this package than the project.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export function isSeedError(error: unknown): error is SeedError {
    return (
        error instanceof Error &&
        typeof (error as any).vendureCode === 'string' &&
        ((error as any).vendureCode.startsWith('core.preset-') ||
            (error as any).vendureCode.startsWith('core.scenario-'))
    );
}

/**
 * @description
 * The database already has setup data, so a preset would mix with it. Presets seed an empty
 * database only.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export const presetDatabaseNotEmpty = defineError<PresetDatabaseNotEmptyDetails>({
    code: 'core.preset-database-not-empty',
    exit: 1,
    message: details =>
        details.appliedPreset
            ? `The database was already seeded with the "${details.appliedPreset}" preset. A preset runs once, on an empty database.`
            : `The database already has setup data (${describeExisting(details)}). A preset runs once, on an empty database.`,
});

/**
 * @description
 * No preset has the given name.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export const presetUnknown = defineError<{ name: string; available: string[] }>({
    code: 'core.preset-unknown',
    exit: 1,
    message: ({ name, available }) =>
        `There is no preset called "${name}". The presets are: ${available.join(', ')}.`,
});

/**
 * @description
 * An option of the preset is missing or has an invalid value.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export const presetInvalidOption = defineError<{ preset: string; option: string; reason: string }>({
    code: 'core.preset-invalid-option',
    exit: 1,
    message: ({ preset, option, reason }) => `The "${option}" option of the "${preset}" preset ${reason}.`,
});

export function presetDatabaseNotEmptyError(details: PresetDatabaseNotEmptyDetails) {
    const fix: SeedErrorFix[] = [
        {
            description: details.appliedPreset
                ? `Nothing to do: the "${details.appliedPreset}" preset is already applied. Change the store in the Dashboard or with the MCP admin tools.`
                : 'Change the existing store in the Dashboard or with the MCP admin tools, or point the config at an empty database and seed that.',
        },
    ];
    return new SeedError({
        code: presetDatabaseNotEmpty.code,
        message: presetDatabaseNotEmpty.message(details),
        details,
        fix,
    });
}

export function presetUnknownError(name: string, available: string[]) {
    const details = { name, available };
    return new SeedError({
        code: presetUnknown.code,
        message: presetUnknown.message(details),
        details,
        fix: [{ description: `Use one of: ${available.join(', ')}.` }],
    });
}

export function presetInvalidOptionError(preset: string, option: string, reason: string) {
    const details = { preset, option, reason };
    return new SeedError({
        code: presetInvalidOption.code,
        message: presetInvalidOption.message(details),
        details,
    });
}

/**
 * @description
 * A scenario pack could not be loaded, or its manifest is invalid.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export const scenarioInvalid = defineError<{ package: string; reason: string }>({
    code: 'core.scenario-invalid',
    exit: 1,
    message: details => `The scenario package "${details.package}" ${details.reason}.`,
});

/**
 * @description
 * The scenario builds on a preset that the database was not seeded with.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export const scenarioPresetMismatch = defineError<{
    scenario: string;
    preset: string;
    appliedPreset?: string;
}>({
    code: 'core.scenario-preset-mismatch',
    exit: 1,
    message: ({ scenario, preset, appliedPreset }) =>
        appliedPreset
            ? `The "${scenario}" scenario builds on the "${preset}" preset, but the database was seeded with the "${appliedPreset}" preset.`
            : `The "${scenario}" scenario builds on the "${preset}" preset, which has not been applied to the database.`,
});

/**
 * @description
 * The database was already seeded with a scenario.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export const scenarioAlreadySeeded = defineError<{ appliedScenario: string }>({
    code: 'core.scenario-already-seeded',
    exit: 1,
    message: ({ appliedScenario }) =>
        `The database was already seeded with the "${appliedScenario}" scenario. A scenario is seeded once.`,
});

export function scenarioInvalidError(pkg: string, reason: string) {
    const details = { package: pkg, reason };
    return new SeedError({ code: scenarioInvalid.code, message: scenarioInvalid.message(details), details });
}

export function scenarioPresetMismatchError(details: {
    scenario: string;
    preset: string;
    appliedPreset?: string;
}) {
    return new SeedError({
        code: scenarioPresetMismatch.code,
        message: scenarioPresetMismatch.message(details),
        details,
        fix: [
            {
                description: details.appliedPreset
                    ? 'Seed this scenario into a new, empty database.'
                    : `Apply the "${details.preset}" preset first.`,
            },
        ],
    });
}

export function scenarioAlreadySeededError(appliedScenario: string) {
    const details = { appliedScenario };
    return new SeedError({
        code: scenarioAlreadySeeded.code,
        message: scenarioAlreadySeeded.message(details),
        details,
    });
}

function describeExisting(details: PresetDatabaseNotEmptyDetails): string {
    const parts: string[] = [];
    if (details.countries) {
        parts.push(`${details.countries} ${details.countries === 1 ? 'country' : 'countries'}`);
    }
    if (details.zones) {
        parts.push(`${details.zones} ${details.zones === 1 ? 'zone' : 'zones'}`);
    }
    if (details.taxRates) {
        parts.push(`${details.taxRates} ${details.taxRates === 1 ? 'tax rate' : 'tax rates'}`);
    }
    if (details.channels > 1) {
        parts.push(`${details.channels} channels`);
    }
    return parts.join(', ');
}
