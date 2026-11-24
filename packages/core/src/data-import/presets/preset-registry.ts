import { auPreset, euPreset, singleCountryPreset, ukPreset, usPreset } from './builtin-presets';
import { Preset, PresetOptionDefinition } from './preset-types';
import { presetInvalidOptionError, presetUnknownError } from './seed-errors';

const presets = new Map<string, Preset>(
    [euPreset, ukPreset, usPreset, auPreset, singleCountryPreset].map(p => [p.name, p]),
);

/**
 * @description
 * A preset as {@link listPresets} describes it.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export interface PresetDescription {
    name: string;
    description: string;
    options: Record<string, PresetOptionDefinition>;
}

/**
 * @description
 * Returns the preset with the given name, or `undefined`.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export function getPreset(name: string): Preset | undefined {
    return presets.get(name);
}

/**
 * @description
 * Lists the base-data presets: `eu`, `uk`, `us`, `au` and `single-country`.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export function listPresets(): PresetDescription[] {
    return [...presets.values()].map(({ name, description, options }) => ({
        name,
        description,
        options: options ?? {},
    }));
}

/**
 * @description
 * Checks a preset name and its options without touching a database. Throws a {@link SeedError}
 * with the code `core.preset-unknown` or `core.preset-invalid-option`, and returns the preset.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export function validatePresetOptions(name: string, options: Record<string, string>): Preset {
    const preset = presets.get(name);
    if (!preset) {
        throw presetUnknownError(name, [...presets.keys()]);
    }
    const declared = preset.options ?? {};
    for (const key of Object.keys(options)) {
        if (!declared[key]) {
            const known = Object.keys(declared);
            throw presetInvalidOptionError(
                name,
                key,
                known.length
                    ? `is not known; the options are ${known.join(', ')}`
                    : 'is not known; it takes no options',
            );
        }
    }
    for (const [key, definition] of Object.entries(declared)) {
        if (definition.required && !options[key]) {
            throw presetInvalidOptionError(name, key, 'is required');
        }
    }
    const problem = preset.validate?.(options);
    if (problem) {
        throw presetInvalidOptionError(name, problem.option, problem.reason);
    }
    return preset;
}
