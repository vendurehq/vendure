import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { commandLineWithOptionsLast } from './option-order.js';

function program() {
    const root = new Command('vendure');
    const acme = root.command('acme');
    acme.command('deploy').command('plan');
    root.command('doctor');
    return root;
}

describe('commandLineWithOptionsLast', () => {
    it('moves the options after the full command path', () => {
        expect(
            commandLineWithOptionsLast(program(), ['acme', 'deploy', '--environment', 'prod', 'plan']),
        ).toBe('vendure acme deploy plan --environment prod');
    });

    it('quotes an argument that a shell would split or read differently', () => {
        expect(
            commandLineWithOptionsLast(program(), ['acme', 'deploy', '--message', "it's done now", 'plan']),
        ).toBe(`vendure acme deploy plan --message 'it'\\''s done now'`);
    });

    it('gives nothing when the arguments name no command', () => {
        expect(commandLineWithOptionsLast(program(), ['--json'])).toBeUndefined();
        expect(commandLineWithOptionsLast(program(), ['nope', '--json'])).toBeUndefined();
    });
});
