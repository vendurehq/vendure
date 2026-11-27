import { log } from '@clack/prompts';

export function render(output: { plugin: string; resolver: string; crud: boolean }): void {
    log.success(
        `Added an Admin API extension to ${output.plugin}, resolved by ${output.resolver}` +
            (output.crud ? ', with CRUD operations' : ''),
    );
}
