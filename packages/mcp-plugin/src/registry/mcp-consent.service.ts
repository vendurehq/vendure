import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import { MCP_PLUGIN_OPTIONS } from '../constants';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';

/** How long a consent digest stays valid: long enough for a person to read the preview and approve it. */
export const CONSENT_DIGEST_TTL_MS = 10 * 60_000;

const DIGEST_VERSION = 'v1';

/** Separates the consent key from every other key derived from `oauth.tokenSecret`. */
const CONSENT_KEY_INFO = 'vendure-mcp-consent-digest';

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
 * A digest is `<version>.<expiry>.<mac>`, where the MAC is an HMAC-SHA256 over the subject and the
 * expiry. So a digest cannot be computed without the server's key, it only applies to the caller,
 * the input and the preview it was issued for, and it expires.
 *
 * With OAuth configured, the key is derived from `oauth.tokenSecret`, so every instance behind a
 * load balancer accepts the digests of the others. Without it, the key is random per process. That
 * covers local trust, which is one dev server, but a digest issued by one instance is refused by
 * another, and a restart makes outstanding digests invalid, which shows the caller the preview again.
 */
@Injectable()
export class McpConsentService {
    private readonly key: Buffer;

    constructor(@Inject(MCP_PLUGIN_OPTIONS) options: Pick<ResolvedMcpPluginOptions, 'oauth'>) {
        const sharedSecret = options.oauth?.tokenSecret;
        this.key = sharedSecret
            ? Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.alloc(0), CONSENT_KEY_INFO, 32))
            : randomBytes(32);
    }

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

/**
 * Code-unit order, not `localeCompare`: every instance must produce the same canonical form, and
 * `localeCompare` depends on the locale.
 */
function compareCodeUnits(a: string, b: string): number {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort(compareCodeUnits)
                .filter(key => (value as Record<string, unknown>)[key] !== undefined)
                .map(key => [key, sortKeys((value as Record<string, unknown>)[key])]),
        );
    }
    return value;
}
