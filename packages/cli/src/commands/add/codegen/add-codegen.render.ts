import { log, note } from '@clack/prompts';

export function render(output: { plugin: string; modifiedFiles: string[]; nextSteps: string[] }): void {
    log.success(`Codegen is set up for ${output.plugin}`);
    note(output.nextSteps.map((step, index) => `${index + 1}. ${step}`).join('\n'), 'Next steps');
}
