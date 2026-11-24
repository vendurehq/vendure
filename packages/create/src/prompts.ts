import { isCancel, multiselect, select, text } from '@clack/prompts';

import { CreateError } from './errors.js';

import { CREATE_OPTIONS, PRESET_OPTION_FLAGS, RawCreateFlags } from './options.js';
import { PresetDescription } from './presets.js';
import { FEATURE_SETS, SCENARIOS } from './registries.js';
import { STOREFRONT_STARTERS } from './storefront-starters.js';
import { AGENT_CLIENTS } from './types.js';

function answer<T>(value: T | symbol): T {
    if (isCancel(value)) {
        throw new CreateError('create.cancelled', 'Setup cancelled.');
    }
    return value;
}

function describe(key: keyof RawCreateFlags): string {
    return CREATE_OPTIONS.find(option => option.key === key)?.description ?? key;
}

/**
 * Asks for every choice that has no flag, and returns the flags with the answers merged in. Each
 * prompt has a flag in the option table, so `--yes` and `--json` never need one.
 */
export async function promptForMissing(
    projectDirectory: string | undefined,
    flags: RawCreateFlags,
    presets: readonly PresetDescription[],
): Promise<{ projectDirectory: string; flags: RawCreateFlags }> {
    const result: RawCreateFlags = { ...flags };
    const directory =
        projectDirectory ??
        answer(
            await text({
                message: 'Where should the project be created?',
                placeholder: 'my-shop',
                validate: value => (value?.trim() ? undefined : 'Enter a directory name'),
            }),
        ).trim();

    if (result.storefront === undefined) {
        result.storefront = answer(
            await select({
                message: 'Add a storefront?',
                options: [
                    { label: 'No storefront', value: 'none', hint: 'Vendure server and Dashboard only' },
                    ...STOREFRONT_STARTERS.map(s => ({ label: s.name, value: s.id, hint: s.description })),
                ],
                initialValue: 'none',
            }),
        );
    }

    if (result.scenario === undefined && SCENARIOS.length) {
        result.scenario = answer(
            await select({
                message: 'Seed a demo scenario?',
                options: [
                    { label: 'No scenario', value: 'none' },
                    ...SCENARIOS.map(s => ({ label: s.name, value: s.name, hint: s.description })),
                ],
                initialValue: 'none',
            }),
        );
    }

    // A scenario brings its own preset.
    const scenarioChosen = result.scenario !== undefined && result.scenario !== 'none';
    if (result.preset === undefined && !scenarioChosen && presets.length) {
        const presetName = answer(
            await select({
                message: 'Which base data should the first `vendure dev` seed?',
                options: [
                    { label: 'None', value: '', hint: 'Only the default channel' },
                    ...presets.map(p => ({ label: p.name, value: p.name, hint: p.description })),
                ],
                initialValue: '',
            }),
        );
        result.preset = presetName || undefined;
    }
    const preset = presets.find(p => p.name === result.preset);
    for (const key of PRESET_OPTION_FLAGS) {
        const option = preset?.options[key];
        if (option?.required && result[key] === undefined) {
            result[key] = answer(
                await text({
                    message: option.description,
                    validate: value => (value?.trim() ? undefined : `Enter the ${key}`),
                }),
            ).trim();
        }
    }

    if (result.features === undefined && FEATURE_SETS.length) {
        const features = answer(
            await multiselect({
                message: describe('features'),
                options: FEATURE_SETS.map(f => ({ label: f.name, value: f.name, hint: f.description })),
                required: false,
            }),
        );
        result.features = features.join(',');
    }

    if (result.agents === undefined) {
        const agents = answer(
            await multiselect({
                message: 'Which AI agent clients should the project be set up for?',
                options: AGENT_CLIENTS.map(client => ({ label: client, value: client })),
                initialValues: [...AGENT_CLIENTS],
                required: false,
            }),
        );
        result.agents = agents.length ? agents.join(',') : 'none';
    }

    return { projectDirectory: directory, flags: result };
}
