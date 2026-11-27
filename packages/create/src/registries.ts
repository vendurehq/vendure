import type { CreateRecordPreset, CreateRecordScenario } from '@vendure/common/lib/create-record';

import { CreateError } from './errors.js';

/**
 * A scenario `--scenario` can name: a package of demo data, and the preset it builds on. create
 * adds the package to `devDependencies` and records it. It never reads the scenario's data.
 */
export interface ScenarioDefinition {
    name: string;
    description: string;
    package: string;
    version: string;
    preset: CreateRecordPreset;
}

/** A set of plugins `--features` can name, added to the project's dependencies. */
export interface FeatureSetDefinition {
    name: string;
    description: string;
    dependencies: Record<string, string>;
}

/** No scenario is available yet. `--scenario none` is the only valid value. */
export const SCENARIOS: readonly ScenarioDefinition[] = [];

/** No feature set is available yet. */
export const FEATURE_SETS: readonly FeatureSetDefinition[] = [];

export function findScenario(
    name: string,
    scenarios: readonly ScenarioDefinition[] = SCENARIOS,
): ScenarioDefinition {
    const scenario = scenarios.find(s => s.name === name);
    if (!scenario) {
        throw new CreateError(
            'create.scenario-unknown',
            `Unknown scenario "${name}".`,
            scenarios.length
                ? `Use one of ${scenarios.map(s => s.name).join(', ')}, or none.`
                : 'No scenarios are available in this version. Use --scenario none.',
        );
    }
    return scenario;
}

export function findFeatureSets(
    names: readonly string[],
    featureSets: readonly FeatureSetDefinition[] = FEATURE_SETS,
): FeatureSetDefinition[] {
    return names.map(name => {
        const featureSet = featureSets.find(f => f.name === name);
        if (!featureSet) {
            throw new CreateError(
                'create.feature-unknown',
                `Unknown feature set "${name}".`,
                featureSets.length
                    ? `Use one or more of ${featureSets.map(f => f.name).join(', ')}.`
                    : 'No feature sets are available in this version. Leave --features out.',
            );
        }
        return featureSet;
    });
}

/**
 * Resolves the preset that will run. A scenario declares the preset it builds on, so `--scenario`
 * alone records that preset. A `--preset` that names the same preset is accepted, and any other
 * preset is refused, so the record's preset is always the one that runs.
 */
export function resolvePresetAndScenario(
    preset: CreateRecordPreset | null,
    scenario: ScenarioDefinition | null,
): { preset: CreateRecordPreset | null; scenario: CreateRecordScenario | null } {
    if (!scenario) {
        return { preset, scenario: null };
    }
    const scenarioRecord = { name: scenario.name, package: scenario.package, version: scenario.version };
    if (preset && !sameOrUnsetOptions(preset, scenario.preset)) {
        throw new CreateError(
            'create.preset-conflicts-with-scenario',
            `The scenario "${scenario.name}" builds on the preset "${describePreset(scenario.preset)}", ` +
                `not "${describePreset(preset)}".`,
            `Leave --preset out to use the scenario's preset, or use --scenario none.`,
        );
    }
    return {
        preset: { name: scenario.preset.name, options: { ...scenario.preset.options } },
        scenario: scenarioRecord,
    };
}

/** The same preset, with either no options given or the scenario's own options. */
function sameOrUnsetOptions(given: CreateRecordPreset, required: CreateRecordPreset): boolean {
    if (given.name !== required.name) {
        return false;
    }
    return Object.entries(given.options).every(([key, value]) => required.options[key] === value);
}

function describePreset(preset: CreateRecordPreset): string {
    const options = Object.entries(preset.options).map(([key, value]) => `${key}=${value}`);
    return options.length ? `${preset.name} (${options.join(', ')})` : preset.name;
}
