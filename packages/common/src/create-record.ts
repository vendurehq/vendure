/*
 * The record `@vendure/create` writes of what a project was created with, at
 * `.vendure/create.json`. `@vendure/create`, `@vendure/cloud` and `vendure seed` all read it
 * through {@link parseCreateRecord}. Each reads the file itself: this module imports no `node:`
 * module, so any package can use it.
 *
 * The file is committed, and written once, by create. No later command writes it. Whether a seed
 * has run is recorded in the database, not here.
 */

/**
 * The path of the record, relative to the project directory.
 */
export const CREATE_RECORD_PATH = '.vendure/create.json';

/**
 * The format version this module reads and writes. A reader ignores a record with a higher version
 * and names the version in a notice. An optional field can be added without a new version; removing
 * a field or changing its meaning needs one.
 */
export const CREATE_RECORD_VERSION = 1;

/** The package managers create can record. */
export const CREATE_RECORD_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

export type CreateRecordPackageManager = (typeof CREATE_RECORD_PACKAGE_MANAGERS)[number];

/** The base-data preset a project was created with. */
export interface CreateRecordPreset {
    name: string;
    /** Option names mapped to string values. `{}` for a preset without options. */
    options: Record<string, string>;
}

/** The scenario a project was created with, as create added it to `devDependencies`. */
export interface CreateRecordScenario {
    name: string;
    package: string;
    version: string;
}

/**
 * The content of `.vendure/create.json`, version 1.
 */
export interface CreateRecord {
    version: typeof CREATE_RECORD_VERSION;
    /** The `@vendure/create` version that wrote the record. */
    createdWith: string;
    packageManager: CreateRecordPackageManager;
    /** The preset that will run. `null` when no preset applies. */
    preset: CreateRecordPreset | null;
    /** `null` for `--scenario none`. */
    scenario: CreateRecordScenario | null;
    features: string[];
    /** For example `nextjs` or `tanstack`. `null` for no storefront. */
    storefront: string | null;
    agents: string[];
}

/**
 * The result of {@link parseCreateRecord}.
 *
 * - `ok`: the record.
 * - `unsupported-version`: the record has a version this reader does not know. Ignore the file and
 *   name the version in a notice. Never guess.
 * - `invalid`: the record is not valid. `field` names the first invalid field, or is `undefined`
 *   when the value is not an object.
 */
export type ParseCreateRecordResult =
    | { result: 'ok'; record: CreateRecord }
    | { result: 'unsupported-version'; version: unknown }
    | { result: 'invalid'; field: string | undefined; message: string };

/**
 * Checks a parsed `.vendure/create.json` against version 1 of the format. Fields it does not know
 * are ignored and left out of the returned record.
 */
export function parseCreateRecord(json: unknown): ParseCreateRecordResult {
    if (!isObject(json)) {
        return invalid(undefined, 'The record is not a JSON object');
    }
    const { version } = json;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        return invalid('version', 'version must be a positive integer');
    }
    if (version !== CREATE_RECORD_VERSION) {
        return { result: 'unsupported-version', version };
    }
    if (typeof json.createdWith !== 'string') {
        return invalid('createdWith', 'createdWith must be a string');
    }
    if (!CREATE_RECORD_PACKAGE_MANAGERS.includes(json.packageManager as CreateRecordPackageManager)) {
        return invalid(
            'packageManager',
            `packageManager must be one of ${CREATE_RECORD_PACKAGE_MANAGERS.join(', ')}`,
        );
    }
    const preset = parsePreset(json.preset);
    if (preset === INVALID) {
        return invalid('preset', 'preset must be null or {name: string, options: {[name]: string}}');
    }
    const scenario = parseScenario(json.scenario);
    if (scenario === INVALID) {
        return invalid('scenario', 'scenario must be null or {name, package, version}, all strings');
    }
    if (!isStringArray(json.features)) {
        return invalid('features', 'features must be an array of strings');
    }
    if (json.storefront !== null && typeof json.storefront !== 'string') {
        return invalid('storefront', 'storefront must be a string or null');
    }
    if (!isStringArray(json.agents)) {
        return invalid('agents', 'agents must be an array of strings');
    }
    return {
        result: 'ok',
        record: {
            version: CREATE_RECORD_VERSION,
            createdWith: json.createdWith,
            packageManager: json.packageManager as CreateRecordPackageManager,
            preset,
            scenario,
            features: [...json.features],
            storefront: json.storefront,
            agents: [...json.agents],
        },
    };
}

const INVALID = Symbol('invalid');

function parsePreset(value: unknown): CreateRecordPreset | null | typeof INVALID {
    if (value === null) {
        return null;
    }
    if (!isObject(value) || typeof value.name !== 'string' || !value.name || !isObject(value.options)) {
        return INVALID;
    }
    const options: Record<string, string> = {};
    for (const [key, optionValue] of Object.entries(value.options)) {
        if (typeof optionValue !== 'string') {
            return INVALID;
        }
        options[key] = optionValue;
    }
    return { name: value.name, options };
}

function parseScenario(value: unknown): CreateRecordScenario | null | typeof INVALID {
    if (value === null) {
        return null;
    }
    if (
        !isObject(value) ||
        typeof value.name !== 'string' ||
        !value.name ||
        typeof value.package !== 'string' ||
        !value.package ||
        typeof value.version !== 'string' ||
        !value.version
    ) {
        return INVALID;
    }
    return { name: value.name, package: value.package, version: value.version };
}

function invalid(field: string | undefined, message: string): ParseCreateRecordResult {
    return { result: 'invalid', field, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}
