import { log } from '@clack/prompts';

import { SeedOutput, SeedStep } from './seed.schema.js';

export function render(output: SeedOutput): void {
    if (output.presets) {
        const lines = output.presets.map(preset => {
            const options = Object.entries(preset.options)
                .map(([name, option]) => `--${name}${option.required ? '' : ' (optional)'}`)
                .join(' ');
            return `${preset.name}${options ? ` ${options}` : ''}\n  ${preset.description}`;
        });
        log.info(`Presets:\n${lines.join('\n')}`);
        return;
    }
    if (output.preset) {
        renderStep('Preset', output.preset);
    }
    if (output.scenario) {
        renderStep('Scenario', output.scenario);
    }
}

function renderStep(label: string, step: SeedStep): void {
    const name = step.name ? ` ${step.name}` : '';
    switch (step.status) {
        case 'applied': {
            const created = Object.entries(step.created ?? {})
                .filter(([, count]) => count > 0)
                .map(([entity, count]) => `${count} ${entity}`)
                .join(', ');
            log.success(`${label}${name} applied${created ? `: created ${created}` : ''}`);
            break;
        }
        case 'already-applied':
            log.info(`${label}${name} was already applied to this database`);
            break;
        case 'skipped':
            log.info(`${label}${name} skipped: ${step.reason ?? ''}`);
            break;
        case 'failed':
            log.error(`${label}${name} failed: ${step.reason ?? ''}`);
            break;
    }
}
