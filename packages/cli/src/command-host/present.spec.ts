import { CommandDefinition, defineCommand } from '@vendure/common/lib/command';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { credentialNeed } from '../auth/credential.js';

import { HostResult } from './host.js';
import { presentForPeople } from './present.js';

const def: CommandDefinition = defineCommand({
    path: ['acme', 'sync'],
    description: 'Sync',
    behavior: 'mutating',
    schemas: async () => ({ input: z.object({ name: z.string() }) }),
    run: async () => ({ run: async () => ({}) }),
});

function incompleteWith(needs: unknown[]): HostResult {
    return {
        envelope: { vendure: 'result', schemaVersion: 1, status: 'incomplete', notices: [], needs },
        exitCode: 3,
    } as unknown as HostResult;
}

async function stderrOf(result: HostResult): Promise<string> {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(text => {
        written.push(String(text));
        return true;
    });
    await presentForPeople(def, result);
    return written.join('');
}

describe('presentForPeople', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shows a secret input by name with stdin as the way to pass it, and its fix as a command line', async () => {
        const text = await stderrOf(incompleteWith([credentialNeed()]));

        expect(text).not.toContain('--token');
        expect(text).toContain('token (secret): A Vendure Cloud credential');
        expect(text).toContain('Pass it in the --input document on stdin.');
        expect(text).toContain('vendure auth login --json');
    });

    it('shows an input need as a flag, with the command line of its fix', async () => {
        const text = await stderrOf(
            incompleteWith([
                {
                    kind: 'input',
                    field: 'consoleProject',
                    description: 'The Project to link',
                    fix: { description: 'List the Projects', path: ['acme', 'list'], input: { all: true } },
                },
            ]),
        );

        expect(text).toContain('  --console-project: The Project to link.');
        expect(text).toContain('      List the Projects: vendure acme list --all');
    });
});
