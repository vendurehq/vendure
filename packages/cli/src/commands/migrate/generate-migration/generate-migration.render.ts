import { log } from '@clack/prompts';

export function render(output: { file: string | null }): void {
    if (output.file) {
        log.success(`New migration generated: ${output.file}`);
    } else {
        log.info('No changes in the database schema were found, so no migration was generated.');
    }
}
