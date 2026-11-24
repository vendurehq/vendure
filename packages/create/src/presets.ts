import type { CreateRecordPreset } from '@vendure/common/lib/create-record';
import fs from 'fs-extra';
import path from 'node:path';

import { CreateError } from './errors.js';

/**
 * A base-data preset as `listPresets()` in `@vendure/core` describes it. create cannot load
 * `@vendure/core` before the project is installed, so `build.cts` writes the list of the
 * `@vendure/core` version create installs to `assets/presets.json`.
 */
export interface PresetDescription {
    name: string;
    description: string;
    options: Record<string, { description: string; required?: boolean }>;
}

export const PRESETS_ASSET = 'presets.json';

export function readPresetCatalog(
    assetsDir: string = path.join(import.meta.dirname, '../assets'),
): PresetDescription[] {
    return fs.readJsonSync(path.join(assetsDir, PRESETS_ASSET)) as PresetDescription[];
}

/**
 * Checks a preset name and its options against the catalog. The values themselves, such as
 * whether a country code exists, are checked by `vendure seed` when it applies the preset.
 */
export function validatePreset(
    preset: CreateRecordPreset,
    catalog: readonly PresetDescription[],
): CreateRecordPreset {
    const description = catalog.find(p => p.name === preset.name);
    if (!description) {
        throw new CreateError(
            'create.preset-unknown',
            `Unknown preset "${preset.name}".`,
            `Use one of ${catalog.map(p => p.name).join(', ')}, or leave --preset out.`,
        );
    }
    const declared = Object.keys(description.options);
    for (const key of Object.keys(preset.options)) {
        if (!description.options[key]) {
            throw new CreateError(
                'create.preset-invalid-option',
                `The preset "${preset.name}" has no option "${key}".`,
                declared.length
                    ? `Its options are ${declared.map(o => `--${o}`).join(', ')}.`
                    : 'It takes no options.',
            );
        }
    }
    const missing = Object.entries(description.options)
        .filter(([key, option]) => option.required && !preset.options[key])
        .map(([key]) => key);
    if (missing.length) {
        throw new CreateError(
            'create.preset-option-missing',
            `The preset "${preset.name}" needs ${missing.map(o => `--${o}`).join(' and ')}.`,
            `For example: --preset ${preset.name} ${missing.map(o => `--${o} <${o}>`).join(' ')}`,
        );
    }
    return { name: preset.name, options: { ...preset.options } };
}
