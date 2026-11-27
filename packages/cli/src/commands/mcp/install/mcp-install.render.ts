import { log, note } from '@clack/prompts';

interface Output {
    client: string;
    action: 'created' | 'updated' | 'unchanged' | 'printed' | 'registered' | 'run-yourself';
    file: string | null;
    config: string | null;
    command: string | null;
}

export function render(output: Output): void {
    switch (output.action) {
        case 'created':
        case 'updated':
            log.success(
                `Added the Developer MCP server to ${output.file ?? ''}. Commit the file, so every clone and worktree gets it.`,
            );
            return;
        case 'unchanged':
            log.info(`${output.file ?? ''} already has the Developer MCP server.`);
            return;
        case 'printed':
            if (output.config) {
                note(output.config, `Add this to ${output.file ?? 'the config'}`);
            } else if (output.command) {
                note(output.command, 'Run this to register the server');
            }
            return;
        case 'registered':
            log.success('Registered the Developer MCP server with Claude Code for this machine.');
            return;
        case 'run-yourself':
            note(output.command ?? '', 'Run this to register the server');
            return;
    }
}
