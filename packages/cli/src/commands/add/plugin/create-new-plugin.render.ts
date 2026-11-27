import { log } from '@clack/prompts';

export function render(output: { plugin: string; dir: string }): void {
    log.success(`Created ${output.plugin} in ${output.dir}, and added it to the Vendure config`);
}
