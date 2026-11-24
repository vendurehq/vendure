/**
 * @description
 * The codes of a {@link SeedError}.
 *
 * - `core.preset-unknown`: no preset has the name. Details: `{name, available}`.
 * - `core.preset-invalid-option`: an option is missing, unknown or invalid. Details:
 *   `{preset, option, reason}`.
 * - `core.preset-database-not-empty`: the database already has setup data or a preset sentinel.
 *   Details: {@link PresetDatabaseNotEmptyDetails}.
 * - `core.scenario-invalid`: a scenario pack could not be loaded, or its manifest is invalid.
 *   Details: `{package, reason}`.
 * - `core.scenario-preset-mismatch`: the database was not seeded with the scenario's preset.
 *   Details: `{scenario, preset, appliedPreset?}`.
 * - `core.scenario-already-seeded`: the database was already seeded with a scenario. Details:
 *   `{appliedScenario}`.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export type SeedErrorCode =
    | 'core.preset-unknown'
    | 'core.preset-invalid-option'
    | 'core.preset-database-not-empty'
    | 'core.scenario-invalid'
    | 'core.scenario-preset-mismatch'
    | 'core.scenario-already-seeded';

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
    taxCategories: number;
    shippingMethods: number;
    paymentMethods: number;
    products: number;
    channels: number;
    /** The preset recorded in the `vendure.seed.preset` sentinel, if one was applied. */
    appliedPreset?: string;
}

/**
 * @description
 * An error thrown by {@link applyPreset} or {@link seedScenario}. It carries a namespaced
 * {@link SeedErrorCode}, the details the message was built from, and fixes.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export class SeedError<Details = any> extends Error {
    readonly vendureCode: SeedErrorCode;
    readonly details: Details;
    readonly fix: SeedErrorFix[];

    constructor(options: { code: SeedErrorCode; message: string; details: Details; fix?: SeedErrorFix[] }) {
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
    const code = (error as { vendureCode?: unknown } | undefined)?.vendureCode;
    return (
        error instanceof Error &&
        typeof code === 'string' &&
        (code.startsWith('core.preset-') || code.startsWith('core.scenario-'))
    );
}

export function presetDatabaseNotEmptyError(details: PresetDatabaseNotEmptyDetails) {
    return new SeedError({
        code: 'core.preset-database-not-empty',
        message: details.appliedPreset
            ? `The database was already seeded with the "${details.appliedPreset}" preset. A preset runs once, on an empty database.`
            : `The database already has setup data (${describeExisting(details)}). A preset runs once, on an empty database.`,
        details,
        fix: [
            {
                description: details.appliedPreset
                    ? `Nothing to do: the "${details.appliedPreset}" preset is already applied. Change the store in the Dashboard or with the MCP admin tools.`
                    : 'Change the existing store in the Dashboard or with the MCP admin tools, or point the config at an empty database and seed that.',
            },
        ],
    });
}

export function presetUnknownError(name: string, available: string[]) {
    return new SeedError({
        code: 'core.preset-unknown',
        message: `There is no preset called "${name}". The presets are: ${available.join(', ')}.`,
        details: { name, available },
        fix: [{ description: `Use one of: ${available.join(', ')}.` }],
    });
}

export function presetInvalidOptionError(preset: string, option: string, reason: string) {
    return new SeedError({
        code: 'core.preset-invalid-option',
        message: `The "${option}" option of the "${preset}" preset ${reason}.`,
        details: { preset, option, reason },
    });
}

export function scenarioInvalidError(pkg: string, reason: string) {
    return new SeedError({
        code: 'core.scenario-invalid',
        message: `The scenario package "${pkg}" ${reason}.`,
        details: { package: pkg, reason },
    });
}

export function scenarioPresetMismatchError(details: {
    scenario: string;
    preset: string;
    appliedPreset?: string;
}) {
    const { scenario, preset, appliedPreset } = details;
    return new SeedError({
        code: 'core.scenario-preset-mismatch',
        message: appliedPreset
            ? `The "${scenario}" scenario builds on the "${preset}" preset, but the database was seeded with the "${appliedPreset}" preset.`
            : `The "${scenario}" scenario builds on the "${preset}" preset, which has not been applied to the database.`,
        details,
        fix: [
            {
                description: appliedPreset
                    ? 'Seed this scenario into a new, empty database.'
                    : `Apply the "${preset}" preset first.`,
            },
        ],
    });
}

export function scenarioAlreadySeededError(appliedScenario: string) {
    return new SeedError({
        code: 'core.scenario-already-seeded',
        message: `The database was already seeded with the "${appliedScenario}" scenario. A scenario is seeded once.`,
        details: { appliedScenario },
    });
}

function describeExisting(details: PresetDatabaseNotEmptyDetails): string {
    const parts: string[] = [];
    const add = (count: number, one: string, many: string) => {
        if (count) {
            parts.push(`${count} ${count === 1 ? one : many}`);
        }
    };
    add(details.countries, 'country', 'countries');
    add(details.zones, 'zone', 'zones');
    add(details.taxCategories, 'tax category', 'tax categories');
    add(details.taxRates, 'tax rate', 'tax rates');
    add(details.shippingMethods, 'shipping method', 'shipping methods');
    add(details.paymentMethods, 'payment method', 'payment methods');
    add(details.products, 'product', 'products');
    if (details.channels > 1) {
        parts.push(`${details.channels} channels`);
    }
    return parts.join(', ');
}
