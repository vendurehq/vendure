import { log } from '@clack/prompts';

export function render(output: { service: string; plugin: string; entity: string | null }): void {
    log.success(
        output.entity
            ? `Added ${output.service} to ${output.plugin}, with CRUD methods for ${output.entity}`
            : `Added ${output.service} to ${output.plugin}`,
    );
}
