import { Injectable } from '@nestjs/common';
import { CachedSession, RequestContext, SessionService } from '@vendure/core';

const REFUSAL = {
    signedInUser:
        'This session token belongs to a signed-in user and cannot be used for anonymous shop access.',
    unknownToken:
        'This sessionToken is not valid or has expired. Retry the call without sessionToken; ' +
        'a tool that writes to the cart will start a new cart and return a new sessionToken.',
    authenticatedCall:
        'This call is authenticated, so it already acts on the signed-in customer. ' +
        'sessionToken is only for anonymous shop access, omit it.',
};

export type ShopSessionOutcome =
    | { kind: 'refused'; message: string }
    | { kind: 'unchanged' }
    | { kind: 'resolved'; ctx: RequestContext; sessionToken?: string };

export type PreparedShopSessionCall =
    | { kind: 'refused'; message: string }
    | {
          kind: 'prepared';
          ctx: RequestContext;
          input: Record<string, unknown>;
          sessionToken?: string;
      };

// Decides which Vendure session an anonymous shop call acts on, whether the token arrives as a tool argument or a header.
@Injectable()
export class McpShopSessionService {
    constructor(private readonly sessionService: SessionService) {}

    async prepareToolCall(call: {
        ctx: RequestContext;
        input: Record<string, unknown>;
        isOAuthCall: boolean;
        toolWritesToCart: boolean;
    }): Promise<PreparedShopSessionCall> {
        const { sessionToken, ...input } = call.input;
        const outcome = await this.resolveForToolCall({
            ctx: call.ctx,
            sessionToken: typeof sessionToken === 'string' ? sessionToken : undefined,
            isOAuthCall: call.isOAuthCall,
            toolWritesToCart: call.toolWritesToCart,
        });
        if (outcome.kind === 'refused') {
            return outcome;
        }
        if (outcome.kind === 'unchanged') {
            return { kind: 'prepared', ctx: call.ctx, input };
        }
        return { kind: 'prepared', ctx: outcome.ctx, input, sessionToken: outcome.sessionToken };
    }

    /** Adds the resolved token without losing handler results that are not plain objects. */
    addSessionTokenToResult(output: unknown, sessionToken: string | undefined): unknown {
        if (sessionToken === undefined) {
            return output;
        }
        if (typeof output !== 'object' || output === null || Array.isArray(output)) {
            return { result: output, sessionToken };
        }
        return { ...output, sessionToken };
    }

    /** An explicit `sessionToken` argument wins over the session already on the context. */
    async resolveForToolCall(call: {
        ctx: RequestContext;
        sessionToken: string | undefined;
        isOAuthCall: boolean;
        toolWritesToCart: boolean;
    }): Promise<ShopSessionOutcome> {
        const sessionToken = trimmed(call.sessionToken);

        // An OAuth call already acts on the customer behind the grant; a token argument is a mistake.
        if (call.isOAuthCall) {
            return sessionToken ? refused(REFUSAL.authenticatedCall) : { kind: 'unchanged' };
        }

        // A signed-in customer's context must not be swapped to an anonymous cart by a stale token.
        if (sessionToken && call.ctx.activeUserId != null) {
            return refused(REFUSAL.authenticatedCall);
        }

        // An explicit token must name a live anonymous session.
        if (sessionToken) {
            const session = await this.sessionService.getSessionFromToken(sessionToken);
            if (!session) {
                return refused(REFUSAL.unknownToken);
            }
            if (session.user) {
                return refused(REFUSAL.signedInUser);
            }
            return this.resolved(call.ctx, session);
        }

        // Re-read through the session cache, since an earlier call in the same request may have set the active order.
        const contextToken = call.ctx.session?.token;
        if (contextToken) {
            const session = await this.sessionService.getSessionFromToken(contextToken);
            return session ? this.resolved(call.ctx, session) : { kind: 'unchanged' };
        }

        // No session anywhere. Only a cart-writing tool gets one; a readonly tool has nothing to read.
        if (call.toolWritesToCart) {
            return this.resolved(call.ctx, await this.sessionService.createAnonymousSession());
        }
        return { kind: 'unchanged' };
    }

    async resolveHeaderToken(
        header: string | undefined,
    ): Promise<{ kind: 'refused'; message: string } | { kind: 'resolved'; session?: CachedSession }> {
        const token = trimmed(header);
        const session = token ? await this.sessionService.getSessionFromToken(token) : undefined;
        return session?.user
            ? { kind: 'refused', message: REFUSAL.signedInUser }
            : { kind: 'resolved', session };
    }

    private resolved(ctx: RequestContext, session: CachedSession): ShopSessionOutcome {
        return {
            kind: 'resolved',
            ctx: withSession(ctx, session),
            sessionToken: session.user ? undefined : session.token,
        };
    }
}

function refused(message: string): ShopSessionOutcome {
    return { kind: 'refused', message };
}

/** Agents sometimes pass padding or an empty string; both count as "no token". */
function trimmed(token: string | undefined): string | undefined {
    return token?.trim() || undefined;
}

// Core swaps a private field the same way (see `_currencyCode` in order.service.ts).
function withSession(ctx: RequestContext, session: CachedSession): RequestContext {
    const copy = ctx.copy();
    (copy as any)._session = session;
    return copy;
}
