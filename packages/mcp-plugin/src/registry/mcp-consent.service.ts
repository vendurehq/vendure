import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { McpExecutionContext } from '../internal-types';

/** How long a consent digest stays valid: long enough for a person to read the preview and approve it. */
export const CONSENT_DIGEST_TTL_MS = 10 * 60_000;

const DIGEST_VERSION = 'v1';

/** What a consent digest is bound to. The preview is part of it, so a digest proves the caller saw it. */
export interface ConsentSubject {
    /** The tool's registry key, `<toolset>:<name>`. */
    toolKey: string;
    /** Who asked, from {@link consentCallerKey}. */
    caller: string;
    /** The tool input without the registry's own `confirm` and `sessionToken` fields. */
    input: Record<string, unknown>;
    preview: string;
}

/**
 * Issues and checks the digests that destructive tools ask the caller to send back as `confirm`.
 *
 * A digest is `<version>.<expiry>.<mac>`, where the MAC is an HMAC-SHA256 under a key made at
 * startup and never stored, over the subject and the expiry. So a digest cannot be computed
 * without this process, it only applies to the caller, the input and the preview it was issued
 * for, and it expires. A restart makes every outstanding digest invalid, which only means the
 * caller is shown the preview again.
 */
@Injectable()
export class McpConsentService {
    private readonly key = randomBytes(32);

    issue(subject: ConsentSubject, now = Date.now()): string {
        const expiresAt = now + CONSENT_DIGEST_TTL_MS;
        return `${DIGEST_VERSION}.${expiresAt}.${this.mac(subject, expiresAt).toString('base64url')}`;
    }

    /** True when the digest was issued by this process for this subject and has not expired. */
    verify(digest: unknown, subject: ConsentSubject, now = Date.now()): boolean {
        if (typeof digest !== 'string') {
            return false;
        }
        const [version, expiry, mac, ...rest] = digest.split('.');
        if (version !== DIGEST_VERSION || rest.length > 0 || !expiry || !mac || !/^\d+$/.test(expiry)) {
            return false;
        }
        const expiresAt = Number(expiry);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
            return false;
        }
        const presented = Buffer.from(mac, 'base64url');
        const expected = this.mac(subject, expiresAt);
        return presented.length === expected.length && timingSafeEqual(presented, expected);
    }

    private mac(subject: ConsentSubject, expiresAt: number): Buffer {
        const message = canonicalJson({
            toolKey: subject.toolKey,
            caller: subject.caller,
            input: subject.input,
            preview: subject.preview,
            expiresAt,
        });
        return createHmac('sha256', this.key).update(message, 'utf8').digest();
    }
}

/**
 * Who a consent belongs to, so a digest issued to one caller is refused for another: the local
 * agent, an OAuth grant, a Vendure session, or failing those the client address.
 */
export function consentCallerKey(executionContext: McpExecutionContext): string {
    const { ctx, grant, clientIp, localTrust } = executionContext;
    const userId = ctx.activeUserId != null ? String(ctx.activeUserId) : '';
    if (localTrust) {
        return `local:${userId}`;
    }
    if (grant?.id != null) {
        return `grant:${String(grant.id)}`;
    }
    const sessionToken = ctx.session?.token;
    if (sessionToken) {
        return `session:${createHash('sha256').update(sessionToken).digest('base64url')}:${userId}`;
    }
    if (clientIp) {
        return `ip:${clientIp}`;
    }
    return `none:${userId}`;
}

/** JSON with object keys sorted at every level, so equal values always serialize the same way. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .filter(key => (value as Record<string, unknown>)[key] !== undefined)
                .map(key => [key, sortKeys((value as Record<string, unknown>)[key])]),
        );
    }
    return value;
}
