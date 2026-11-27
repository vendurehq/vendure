import { describe, expect, it } from 'vitest';

import {
    canonicalJson,
    CONSENT_DIGEST_TTL_MS,
    consentCallerKey,
    ConsentSubject,
    McpConsentService,
} from './mcp-consent.service';

const subject: ConsentSubject = {
    toolKey: 'admin:cancel_order',
    caller: 'local:1',
    input: { id: '42', reason: 'Duplicate' },
    preview: 'Cancel order AB12 (id 42)',
};

describe('McpConsentService', () => {
    it('verifies a digest it issued for the same subject', () => {
        const consent = new McpConsentService({});
        expect(consent.verify(consent.issue(subject), subject)).toBe(true);
    });

    it('does not depend on the order of the input keys', () => {
        const consent = new McpConsentService({});
        const digest = consent.issue(subject);
        expect(consent.verify(digest, { ...subject, input: { reason: 'Duplicate', id: '42' } })).toBe(true);
    });

    it.each<[string, Partial<ConsentSubject>]>([
        ['another caller', { caller: 'grant:7' }],
        ['another tool', { toolKey: 'admin:refund_order' }],
        ['another input', { input: { id: '43', reason: 'Duplicate' } }],
        ['another preview', { preview: 'Cancel order AB12 (id 42), now Shipped' }],
    ])('refuses the digest for %s', (_label, change) => {
        const consent = new McpConsentService({});
        expect(consent.verify(consent.issue(subject), { ...subject, ...change })).toBe(false);
    });

    it('refuses a digest once it has expired', () => {
        const consent = new McpConsentService({});
        const digest = consent.issue(subject, 1_000);
        expect(consent.verify(digest, subject, 1_000 + CONSENT_DIGEST_TTL_MS - 1)).toBe(true);
        expect(consent.verify(digest, subject, 1_000 + CONSENT_DIGEST_TTL_MS)).toBe(false);
    });

    it('refuses a digest with its expiry moved later', () => {
        const consent = new McpConsentService({});
        const [version, , mac] = consent.issue(subject, 1_000).split('.');
        const extended = `${version}.${1_000 + 10 * CONSENT_DIGEST_TTL_MS}.${mac}`;
        expect(consent.verify(extended, subject, 1_000 + CONSENT_DIGEST_TTL_MS)).toBe(false);
    });

    // Without a shared secret the key is random per process, so the digest cannot be worked out
    // from the preview and the input alone, and another process refuses it.
    it('refuses a digest issued by another process without a shared secret', () => {
        const other = new McpConsentService({});
        expect(new McpConsentService({}).verify(other.issue(subject), subject)).toBe(false);
    });

    // Behind a load balancer the preview and the confirming call can reach different instances.
    it('accepts a digest issued by another instance with the same oauth.tokenSecret', () => {
        const oauth = { tokenSecret: 'shared-secret' } as any;
        const issuer = new McpConsentService({ oauth });
        expect(new McpConsentService({ oauth }).verify(issuer.issue(subject), subject)).toBe(true);
        const otherSecret = new McpConsentService({ oauth: { tokenSecret: 'other-secret' } as any });
        expect(otherSecret.verify(issuer.issue(subject), subject)).toBe(false);
    });

    it.each([true, undefined, 42, '', 'v1', 'v1.abc.def', 'v2.9999999999999.AAAA', 'v1.1.AAAA.extra'])(
        'refuses %s',
        digest => {
            expect(new McpConsentService({}).verify(digest, subject)).toBe(false);
        },
    );
});

describe('consentCallerKey', () => {
    const ctx = (over: Record<string, unknown> = {}) =>
        ({ activeUserId: 1, session: undefined, ...over }) as any;

    it('tells the local agent, an OAuth grant, a session and an anonymous client apart', () => {
        const keys = [
            consentCallerKey({ ctx: ctx({ session: { token: 'dummy' } }), localTrust: true }),
            consentCallerKey({ ctx: ctx(), grant: { id: 7 } as any }),
            consentCallerKey({ ctx: ctx({ session: { token: 'abc' } }) }),
            consentCallerKey({ ctx: ctx({ activeUserId: undefined }), clientIp: '203.0.113.7' }),
        ];
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys[0]).toBe('local:1');
        expect(keys[1]).toBe('grant:7');
    });

    it('never puts the session token itself in the key', () => {
        expect(consentCallerKey({ ctx: ctx({ session: { token: 'secret-session-token' } }) })).not.toContain(
            'secret-session-token',
        );
    });
});

describe('canonicalJson', () => {
    it('sorts keys at every level and drops undefined values', () => {
        expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe(
            '{"a":{"d":[{"y":2,"z":1}]},"b":1}',
        );
    });
});
