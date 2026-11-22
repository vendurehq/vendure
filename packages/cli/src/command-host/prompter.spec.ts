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

describe('createClackPrompter', () => {
    it('asks for a secret field without echoing it', async () => {
        const answer = await createClackPrompter().askInput({
            kind: 'input',
            field: 'token',
            description: 'The token',
            secret: true,
        });
        expect(answer).toBe('hidden');
        expect(password).toHaveBeenCalledWith({ message: 'The token' });
        expect(text).not.toHaveBeenCalled();
    });

    it('asks for other fields as text, or as a choice when they have choices', async () => {
        const prompter = createClackPrompter();
        expect(await prompter.askInput({ kind: 'input', field: 'name', description: 'The name' })).toBe(
            'typed',
        );
        expect(
            await prompter.askInput({
                kind: 'input',
                field: 'plugin',
                description: 'Plugin',
                choices: ['A'],
            }),
        ).toBe('picked');
        expect(select).toHaveBeenCalled();
    });
});
