import { describe, expect, it, vi } from 'vitest';

vi.mock('@clack/prompts', () => ({
    confirm: vi.fn(),
    isCancel: () => false,
    password: vi.fn(async () => 'hidden'),
    select: vi.fn(async () => 'picked'),
    text: vi.fn(async () => 'typed'),
}));

import { password, select, text } from '@clack/prompts';

import { createClackPrompter } from './prompter.js';

const validate = (answer: string) => (answer ? undefined : 'Required');

describe('createClackPrompter', () => {
    it('asks for a secret field without echoing it', async () => {
        const answer = await createClackPrompter().askInput(
            { kind: 'input', field: 'token', description: 'The token', secret: true },
            validate,
        );
        expect(answer).toBe('hidden');
        expect(password).toHaveBeenCalledWith({ message: 'The token', validate });
        expect(text).not.toHaveBeenCalled();
    });

    it('asks for other fields as text, or as a choice when they have choices', async () => {
        const prompter = createClackPrompter();
        expect(
            await prompter.askInput({ kind: 'input', field: 'name', description: 'The name' }, validate),
        ).toBe('typed');
        // The text prompt checks each answer, so a person can correct it.
        expect(text).toHaveBeenCalledWith({ message: 'The name', validate });
        expect(
            await prompter.askInput(
                { kind: 'input', field: 'plugin', description: 'Plugin', choices: ['A'] },
                validate,
            ),
        ).toBe('picked');
        expect(select).toHaveBeenCalled();
    });
});
