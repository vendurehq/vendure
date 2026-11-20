import { defineCommand } from '@vendure/common/lib/command';

export const commandsDefinition = defineCommand({
    path: ['commands'],
    description: 'List the commands of this project with their input and output schemas',
    keywords: ['list', 'manifest', 'schema', 'discover'],
    behavior: 'readonly',
    // Listing commands over MCP would only repeat what `search_tools` returns.
    expose: { mcp: false },
    schemas: () => import('./commands.schema.js'),
    examples: ['vendure commands --json'],
    run: () => import('./commands.run.js'),
    render: () => import('./commands.render.js'),
});
