import { log } from '@clack/prompts';

export function render(output: { plugin: string; entrypoint: string }): void {
    log.success(`Added Dashboard extensions to ${output.plugin}: ${output.entrypoint}`);
}
