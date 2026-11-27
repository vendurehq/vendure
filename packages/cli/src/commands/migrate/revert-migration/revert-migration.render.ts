import { log } from '@clack/prompts';

export function render(output: { reverted: boolean; migration?: string | null }): void {
    if (!output.reverted) {
        log.info('The database has applied no migration, so there is nothing to revert.');
        return;
    }
    log.success(
        output.migration ? `Reverted the last migration: ${output.migration}` : 'Reverted the last migration',
    );
}
