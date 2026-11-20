import { log } from '@clack/prompts';

export function render(output: { reverted: boolean; migration?: string | null }): void {
    log.success(
        output.migration ? `Reverted the last migration: ${output.migration}` : 'Reverted the last migration',
    );
}
