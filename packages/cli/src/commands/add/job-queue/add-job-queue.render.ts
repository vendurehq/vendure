import { log } from '@clack/prompts';

export function render(output: { service: string; jobQueue: string; triggerMethod: string }): void {
    log.success(
        `Added the job queue ${output.jobQueue} to ${output.service}. Start a job with ${output.triggerMethod}().`,
    );
}
