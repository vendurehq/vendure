import { defineCommand } from '@vendure/common/lib/command';

export const guideDefinition = defineCommand({
    path: ['guide'],
    description: 'Show how an agent works with this CLI, the Developer MCP and the Store MCP',
    keywords: ['agent', 'help', 'skill', 'workflow', 'how', 'start', 'mcp', 'json'],
    behavior: 'readonly',
    schemas: () => import('./guide.schema.js'),
    examples: ['vendure guide', 'vendure guide --json'],
    run: () => import('./guide.run.js'),
    render: () => import('./guide.render.js'),
});
