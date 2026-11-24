import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PresetDescription } from './presets.js';
import { promptForMissing } from './prompts.js';

const answers = vi.hoisted(() => ({ queue: [] as unknown[], messages: [] as string[] }));

// Each prompt returns the next queued answer and records its message.
vi.mock('@clack/prompts', () => {
    const next = ({ message }: { message: string }) => {
        answers.messages.push(message);
        return Promise.resolve(answers.queue.shift());
    };
    return { select: next, text: next, multiselect: next, isCancel: () => false, cancel: vi.fn() };
});

vi.mock('./registries.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./registries.js')>()),
    SCENARIOS: [
        {
            name: 'demo',
            description: 'A demo',
            package: '@example/scenario-demo',
            version: '1.0.0',
            preset: { name: 'uk', options: {} },
        },
    ],
}));

const presets: PresetDescription[] = [
    { name: 'uk', description: 'UK', options: {} },
    {
        name: 'single-country',
        description: 'One country',
        options: {
            country: { description: 'The country code', required: true },
            currency: { description: 'The currency code', required: true },
        },
    },
];

beforeEach(() => {
    answers.queue = [];
    answers.messages = [];
});

describe('promptForMissing()', () => {
    it('asks for the required options of the chosen preset', async () => {
        answers.queue = ['none', 'none', 'single-country', ' NZ ', 'NZD'];
        const result = await promptForMissing('shop', {}, presets);
        expect(result).toEqual({
            projectDirectory: 'shop',
            flags: {
                storefront: 'none',
                scenario: 'none',
                preset: 'single-country',
                country: 'NZ',
                currency: 'NZD',
            },
        });
        expect(answers.messages.slice(-2)).toEqual(['The country code', 'The currency code']);
    });

    it('skips the preset when a scenario was chosen, because the scenario brings its own', async () => {
        answers.queue = ['nextjs', 'demo'];
        const result = await promptForMissing('shop', {}, presets);
        expect(result.flags).toEqual({ storefront: 'nextjs', scenario: 'demo' });
        expect(answers.messages).toHaveLength(2);
    });

    it('turns the "None" preset answer into no preset', async () => {
        answers.queue = ['none', 'none', ''];
        const result = await promptForMissing('shop', {}, presets);
        expect(result.flags.preset).toBeUndefined();
    });

    it('asks only for what the flags left out, including the directory', async () => {
        answers.queue = [' my-shop '];
        const result = await promptForMissing(
            undefined,
            { storefront: 'none', scenario: 'none', preset: 'uk' },
            presets,
        );
        expect(result.projectDirectory).toBe('my-shop');
        expect(answers.messages).toEqual(['Where should the project be created?']);
    });
});
