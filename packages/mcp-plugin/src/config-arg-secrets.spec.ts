import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { describe, expect, it } from 'vitest';

import { keepOmittedSecretArgs, redactSecretConfigArgs } from './config-arg-secrets';

const isSecret = (code: string, name: string) => code === 'card-handler' && name === 'apiKey';

describe('redactSecretConfigArgs', () => {
    it('redacts set secret args in both operation shapes, at any depth', () => {
        expect(
            redactSecretConfigArgs(
                {
                    list: [{ code: 'card-handler', args: { apiKey: 'k1', mode: 'live' } }],
                    admin: { code: 'card-handler', arguments: [{ name: 'apiKey', value: 'k2' }] },
                },
                isSecret,
            ),
        ).toEqual({
            list: [{ code: 'card-handler', args: { apiKey: REDACTED_SECRET_PLACEHOLDER, mode: 'live' } }],
            admin: {
                code: 'card-handler',
                arguments: [{ name: 'apiKey', value: REDACTED_SECRET_PLACEHOLDER }],
            },
        });
    });

    it('leaves an empty secret and the args of other operations alone', () => {
        const value = {
            a: { code: 'card-handler', args: { apiKey: '' } },
            b: { code: 'other', args: { apiKey: 'x' } },
        };
        expect(redactSecretConfigArgs(value, isSecret)).toEqual(value);
    });
});

describe('keepOmittedSecretArgs', () => {
    const stored = {
        code: 'card-handler',
        args: [
            { name: 'apiKey', value: 'encrypted' },
            { name: 'mode', value: 'live' },
        ],
    };

    it('sends the placeholder for a stored secret the update leaves out', () => {
        expect(
            keepOmittedSecretArgs({ code: 'card-handler', args: { mode: 'test' } }, stored, isSecret),
        ).toEqual({
            code: 'card-handler',
            args: { mode: 'test', apiKey: REDACTED_SECRET_PLACEHOLDER },
        });
    });

    it('keeps a secret the update sets, and changes nothing when the code changes', () => {
        expect(
            keepOmittedSecretArgs({ code: 'card-handler', args: { apiKey: 'new' } }, stored, isSecret),
        ).toEqual({
            code: 'card-handler',
            args: { apiKey: 'new' },
        });
        const other = { code: 'other-handler', args: {} };
        expect(keepOmittedSecretArgs(other, stored, isSecret)).toBe(other);
    });
});
