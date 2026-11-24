import { describe, expect, it } from 'vitest';

import { coreCommandDefinitions } from '../../command-host/core-commands.js';

import { AGENT_GUIDE } from './guide.content.js';
import { run } from './guide.run.js';

/** Commands that are not declared with `defineCommand` yet. */
const COMMANDER_COMMANDS = ['dev', 'mcp', 'build', 'start', 'schema', 'codemod', 'plugins'];

describe('vendure guide', () => {
    it('returns the agent guide', async () => {
        expect(await run()).toEqual({ guide: AGENT_GUIDE });
    });

    it('names only commands that exist', () => {
        const paths = coreCommandDefinitions.map(def => def.path.join(' '));
        const groups = new Set(coreCommandDefinitions.map(def => def.path[0]));
        const named = [...AGENT_GUIDE.matchAll(/`(?:npx )?vendure ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)];
        expect(named.length).toBeGreaterThan(5);
        for (const [, first, second] of named) {
            if (COMMANDER_COMMANDS.includes(first)) {
                continue;
            }
            const isGroup = groups.has(first) && !paths.includes(first);
            const path = isGroup ? `${first} ${second}` : first;
            expect(paths, `the guide names "vendure ${path}"`).toContain(path);
        }
    });

    it('uses the Developer MCP and Store MCP names, never a bare "Vendure MCP"', () => {
        expect(AGENT_GUIDE).toContain('Developer MCP');
        expect(AGENT_GUIDE).toContain('Store MCP');
        expect(AGENT_GUIDE).not.toMatch(/Vendure MCP/);
    });
});
