import { defineCommand } from '@vendure/common/lib/command';

import {
    claudeMcpAddFailed,
    cliNotInstalled,
    configUnreadable,
    projectAmbiguous,
    projectNotFound,
    rootCannotResolveCli,
    scopeLocalUnsupported,
} from './mcp-install.errors.js';

export const mcpInstallDefinition = defineCommand({
    path: ['mcp', 'install'],
    description: "Add the Developer MCP server to an MCP client's project config",
    keywords: ['claude', 'cursor', 'vscode', 'codex', 'agent', 'setup'],
    behavior: 'mutating',
    // An MCP client calling this would be configuring itself.
    expose: { mcp: false },
    schemas: () => import('./mcp-install.schema.js'),
    cli: {
        fields: {
            client: { choices: () => Promise.resolve(['claude', 'cursor', 'vscode', 'codex']) },
        },
    },
    errors: [
        projectNotFound,
        projectAmbiguous,
        cliNotInstalled,
        rootCannotResolveCli,
        configUnreadable,
        scopeLocalUnsupported,
        claudeMcpAddFailed,
    ],
    examples: [
        'vendure mcp install --client claude',
        'vendure mcp install --client vscode --print',
        'vendure mcp install --client claude --scope local',
    ],
    run: () => import('./mcp-install.run.js'),
    render: () => import('./mcp-install.render.js'),
});
