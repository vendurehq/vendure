import { buildCommandManifest } from '@vendure/common/lib/command/manifest';
import { describe, expect, it } from 'vitest';

import { coreCommandDefinitions } from '../../command-host/core-commands.js';
import { kebab } from '../../command-host/naming.js';
import { builtinCommandDefs } from '../builtins.js';

import { AGENT_GUIDE } from './guide.content.js';
import { run } from './guide.run.js';

/** Flags every `defineCommand` command has, from the host. */
const HOST_FLAGS = ['--json', '--input', '--format', '--help'];

/** Each `vendure …` command line in a code span of the guide, as its words. */
function commandLines(): string[][] {
    return [...AGENT_GUIDE.matchAll(/`(?:npx )?vendure ([^`]*)`/g)].map(match =>
        match[1].split(/\s+/).filter(Boolean),
    );
}

describe('vendure guide', () => {
    it('returns the agent guide', async () => {
        expect(await run()).toEqual({ guide: AGENT_GUIDE });
    });

    it('names only commands and flags that exist', async () => {
        const manifest = await buildCommandManifest('@vendure/cli', '0.0.0', coreCommandDefinitions);
        const byPath = new Map(manifest.commands.map(command => [command.path.join(' '), command]));
        const commanderCommands = builtinCommandDefs.map(def => def.name);
        const lines = commandLines();
        expect(lines.length).toBeGreaterThan(5);
        for (const words of lines) {
            const [first, second] = words;
            if (first.startsWith('<')) {
                // A placeholder such as `vendure <command> --help`.
                continue;
            }
            const path = byPath.has(`${first} ${second}`) ? `${first} ${second}` : first;
            const command = byPath.get(path);
            if (!command) {
                expect(commanderCommands, `the guide names "vendure ${words.join(' ')}"`).toContain(first);
                continue;
            }
            const fields = Object.keys(command.input.properties ?? {}).map(kebab);
            const allowed = [...HOST_FLAGS, ...fields.flatMap(field => [`--${field}`, `--no-${field}`])];
            for (const flag of words.filter(word => word.startsWith('--'))) {
                expect(allowed, `"vendure ${path}" has no ${flag}`).toContain(flag);
            }
        }
    });

    it('uses the Developer MCP and Store MCP names, never a bare "Vendure MCP"', () => {
        expect(AGENT_GUIDE).toContain('Developer MCP');
        expect(AGENT_GUIDE).toContain('Store MCP');
        expect(AGENT_GUIDE).not.toMatch(/Vendure MCP/);
    });
});
