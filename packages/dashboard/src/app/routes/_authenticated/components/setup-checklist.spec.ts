import { describe, expect, it } from 'vitest';

import { readableFindingMessage } from './setup-checklist.js';

describe('readableFindingMessage', () => {
    it('calls the default channel "the default channel" instead of its code', () => {
        expect(
            readableFindingMessage(
                'The search index of channel "__default_channel__" holds 77 of its 88 product variant(s).',
                '__default_channel__',
            ),
        ).toBe('The search index of the default channel holds 77 of its 88 product variant(s).');
        expect(
            readableFindingMessage(
                'Channel "__default_channel__" has no default shipping zone.',
                '__default_channel__',
            ),
        ).toBe('The default channel has no default shipping zone.');
    });

    it('keeps the code of any other channel', () => {
        const message = 'Channel "uk-store" has no default shipping zone.';
        expect(readableFindingMessage(message, 'uk-store')).toBe(message);
    });
});
