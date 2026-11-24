import { describe, expect, it } from 'vitest';

import { personNeedFromApiError } from './person-need.js';

const refusal = {
    statusCode: 403,
    error: 'Forbidden',
    code: 'PERSON_REQUIRED',
    action: 'production-request',
    message: "A person must take this step. An agent's delegated key cannot.",
};

describe('personNeedFromApiError', () => {
    it('maps a PERSON_REQUIRED refusal to a person need with a Console link', () => {
        expect(
            personNeedFromApiError(refusal, {
                consoleUrl: 'https://console.vendure.io',
                path: '/projects/p1',
            }),
        ).toEqual({
            kind: 'person',
            action: 'production-request',
            summary: 'Request production for the project in Vendure Console',
            url: 'https://console.vendure.io/projects/p1',
        });
    });

    it('reads the refusal from the error an HTTP client throws', () => {
        const need = personNeedFromApiError(
            Object.assign(new Error('403'), { response: { body: refusal } }),
            { consoleUrl: 'https://console.vendure.io' },
        );

        expect(need).toMatchObject({ action: 'production-request', url: 'https://console.vendure.io/' });
    });

    it('still makes a need for an action the CLI does not know yet', () => {
        expect(
            personNeedFromApiError(
                { ...refusal, action: 'something-new' },
                { consoleUrl: 'https://console.vendure.io' },
            ),
        ).toMatchObject({
            action: 'something-new',
            summary: 'A person must take this step in Vendure Console',
        });
    });

    it('returns undefined for any other error', () => {
        expect(
            personNeedFromApiError(
                { code: 'DELEGATED_KEY_SCOPE' },
                { consoleUrl: 'https://console.vendure.io' },
            ),
        ).toBeUndefined();
        expect(
            personNeedFromApiError(new Error('boom'), { consoleUrl: 'https://console.vendure.io' }),
        ).toBeUndefined();
    });
});
