import { describe, expect, it, vi } from 'vitest';

vi.mock('@clack/prompts', () => ({
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    password: vi.fn(async () => 'hidden'),
    select: vi.fn(async () => 'picked'),
    text: vi.fn(async () => 'typed'),
}));

import { confirm, isCancel, password, select, text } from '@clack/prompts';

import { createClackPrompter, OTHER } from './prompter.js';

const validate = (answer: string) => (answer ? undefined : 'Required');

describe('createClackPrompter', () => {
    it('asks for a secret field without echoing it', async () => {
        const answer = await createClackPrompter().askInput(
            { kind: 'input', field: 'token', description: 'The token', secret: true },
            { validate, optional: false, boolean: false },
        );
        expect(answer).toBe('hidden');
        expect(password).toHaveBeenCalledWith({ message: 'The token', validate });
        expect(text).not.toHaveBeenCalled();
    });

    it('asks for other fields as text, or as a choice when they have choices', async () => {
        const prompter = createClackPrompter();
        expect(
            await prompter.askInput(
                { kind: 'input', field: 'name', description: 'The name' },
                { validate, optional: false, boolean: false },
            ),
        ).toBe('typed');
        // The text prompt checks each answer, so a person can correct it.
        expect(text).toHaveBeenCalledWith({ message: 'The name', validate });
        expect(
            await prompter.askInput(
                { kind: 'input', field: 'plugin', description: 'Plugin', choices: ['A'] },
                { validate, optional: false, boolean: false },
            ),
        ).toBe('picked');
        expect(select).toHaveBeenLastCalledWith({
            message: 'Plugin',
            options: [{ value: 'A', label: 'A' }],
        });
    });

    it('offers "None" in the choices of an optional field', async () => {
        await createClackPrompter().askInput(
            { kind: 'input', field: 'entity', description: 'Entity', choices: ['Review'] },
            { validate, optional: true, boolean: false },
        );
        expect(select).toHaveBeenLastCalledWith({
            message: 'Entity',
            options: [
                { value: 'Review', label: 'Review' },
                { value: '', label: 'None' },
            ],
        });
    });

    it('asks for a boolean field as yes or no', async () => {
        vi.mocked(confirm).mockResolvedValueOnce(true);

        const answer = await createClackPrompter().askInput(
            { kind: 'input', field: 'translatable', description: 'Translatable' },
            { validate, optional: true, boolean: true },
        );

        expect(answer).toBe('true');
        expect(confirm).toHaveBeenCalledWith({ message: 'Translatable', initialValue: false });
    });

    it('asks for a line of text for ctx.ask', async () => {
        vi.mocked(text).mockClear();
        const answer = await createClackPrompter().text('Name the environment', { placeholder: 'staging' });
        expect(answer).toBe('typed');
        expect(text).toHaveBeenCalledWith({
            message: 'Name the environment',
            placeholder: 'staging',
            initialValue: undefined,
        });
    });

    it('lets a person type a value instead of a choice when select has other', async () => {
        const prompter = createClackPrompter();
        vi.mocked(select).mockClear();
        vi.mocked(select).mockResolvedValueOnce(OTHER);
        vi.mocked(text).mockClear();
        const answer = await prompter.select('Environment', [{ value: 'prod', label: 'prod' }], {
            other: 'Create a new environment',
        });
        expect(answer).toBe('typed');
        expect(select).toHaveBeenCalledWith({
            message: 'Environment',
            options: [
                { value: 'prod', label: 'prod' },
                { value: OTHER, label: 'Create a new environment' },
            ],
        });
        expect(text).toHaveBeenCalledWith({ message: 'Create a new environment' });

        vi.mocked(select).mockResolvedValueOnce('prod');
        expect(
            await prompter.select('Environment', [{ value: 'prod', label: 'prod' }], { other: 'New' }),
        ).toBe('prod');
    });

    it('returns an empty answer as an empty string, and a cancel as undefined', async () => {
        const prompter = createClackPrompter();
        vi.mocked(text).mockResolvedValueOnce(undefined as unknown as string);
        expect(await prompter.text('Name it')).toBe('');

        const cancelled = Symbol('cancel');
        vi.mocked(text).mockResolvedValueOnce(cancelled);
        vi.mocked(isCancel).mockImplementationOnce(value => value === cancelled);
        expect(await prompter.text('Name it')).toBeUndefined();
    });
});
