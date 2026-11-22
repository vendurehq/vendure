import { log } from '@clack/prompts';

export function render(output: { entity: string; plugin: string }): void {
    log.success(`Added the entity ${output.entity} to ${output.plugin}`);
}
