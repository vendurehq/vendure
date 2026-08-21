import {
    CLIENT_CAPABILITIES_META_KEY,
    LATEST_PROTOCOL_VERSION,
    PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { expect } from 'vitest';

export const MCP_ACCEPT = 'application/json, text/event-stream';

/**
 * The modern protocol revision. `LATEST_PROTOCOL_VERSION` is the newest *legacy* revision — the era
 * that agrees a version once at `initialize` — so it can never name this one. The SDK exports no
 * constant for it, hence the literal.
 */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

export interface McpHttpResult {
    status: number;
    headers: Headers;
    /** Parsed JSON-RPC response (from a JSON or single-frame SSE body), or undefined for empty bodies. */
    body: any;
    text: string;
}

export interface PostMcpOptions {
    token?: string;
    accept?: string;
    contentType?: string;
    protocolVersion?: string;
    /** Extra request headers (e.g. session/channel tokens, Host, Origin). */
    headers?: Record<string, string>;
}

/** JSON-RPC request envelope. */
export function rpc(method: string, params?: unknown, id: number | string | null = 1) {
    return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

/** `tools/call` request envelope. */
export function callTool(name: string, args: Record<string, unknown> = {}, id = 1) {
    return rpc('tools/call', { name, arguments: args }, id);
}

/** initialize request params. */
export function initializeParams(protocolVersion: string = LATEST_PROTOCOL_VERSION) {
    return {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'mcp-e2e', version: '1.0.0' },
    };
}

/**
 * The `_meta` envelope a modern-era request carries inside its `params`. The protocol-version key is
 * what routes the request to the modern era; `clientCapabilities` is required alongside it.
 * `clientInfo` is deliberately absent — it was required in a pre-final draft of the revision and is
 * optional in the final one, so leaving it out keeps these tests honest about that.
 */
function modernEnvelope() {
    return {
        [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
    };
}

/** Parses an MCP HTTP response body, handling both `application/json` and single-frame SSE. */
function parseBody(text: string, contentType: string): any {
    if (!text) {
        return undefined;
    }
    if (contentType.includes('text/event-stream')) {
        // A single `data:` frame parses to its object; multiple frames (a JSON-RPC batch) parse to
        // the array of objects the client reassembles.
        const frames = text
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => JSON.parse(line.slice('data:'.length).trim()));
        if (frames.length === 0) {
            return undefined;
        }
        return frames.length === 1 ? frames[0] : frames;
    }
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** POSTs a JSON-RPC message to `/mcp/{toolset}` and returns the parsed result. */
export async function postMcp(
    baseUrl: string,
    toolset: 'shop' | 'admin',
    message: unknown,
    options: PostMcpOptions = {},
): Promise<McpHttpResult> {
    const headers: Record<string, string> = {
        Accept: options.accept ?? MCP_ACCEPT,
        ...options.headers,
    };
    headers['Content-Type'] = options.contentType ?? 'application/json';
    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }
    // Send a protocol-version header on non-initialize calls (an initialize request carries the
    // version in its body instead).
    const isInitialize = !Array.isArray(message) && (message as any)?.method === 'initialize';
    if (!isInitialize) {
        headers['MCP-Protocol-Version'] = options.protocolVersion ?? LATEST_PROTOCOL_VERSION;
    }
    const response = await fetch(`${baseUrl}/mcp/${toolset}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
    });
    const text = await response.text();
    return {
        status: response.status,
        headers: response.headers,
        text,
        body: parseBody(text, response.headers.get('content-type') ?? ''),
    };
}

/**
 * POSTs a request in the modern (`2026-07-28`) protocol era, adding everything that era requires:
 * the `_meta` envelope inside `params`, and the standard headers the revision mandates — `Mcp-Method`
 * naming the body's method on every request, plus `Mcp-Name` mirroring `params.name` on a
 * `tools/call`. Omitting either header is a header/body disagreement, not a modern request, so the
 * helper always sends them.
 */
export async function postModernMcp(
    baseUrl: string,
    toolset: 'shop' | 'admin',
    method: string,
    params: Record<string, unknown> = {},
    id: number | string = 1,
    options: PostMcpOptions = {},
): Promise<McpHttpResult> {
    const message = rpc(method, { ...params, _meta: modernEnvelope() }, id);
    return postMcp(baseUrl, toolset, message, {
        ...options,
        protocolVersion: MODERN_PROTOCOL_VERSION,
        headers: {
            'Mcp-Method': method,
            ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
            ...options.headers,
        },
    });
}

/**
 * Asserts every part of a rate-limit refusal from the transport's gates: the status, both headers,
 * and the JSON-RPC error body. The error code and the `jsonrpc` version are written out here
 * rather than imported from the plugin, because they are a promise to MCP client software — a test
 * that read them from the plugin's own constants could not notice them changing.
 *
 * Not for a rate-limited `tools/call`: that answers HTTP 200 with an in-band error result instead.
 */
export function expectRateLimitRefusal(
    result: McpHttpResult,
    expected: { scope: string; id: string | number | null },
): void {
    expect(result.status).toBe(429);
    expect(result.headers.get('content-type')).toContain('application/json');
    const retryAfterHeader = Number(result.headers.get('retry-after'));
    expect(retryAfterHeader).toBeGreaterThan(0);
    expect(result.body.jsonrpc).toBe('2.0');
    expect(result.body.id).toBe(expected.id);
    expect(result.body.result).toBeUndefined();
    expect(result.body.error.code).toBe(-31029);
    // The message is the only part of a refusal a human reads, and its scope and delay must agree
    // with the data block and the Retry-After header asserted above. The subject — the method, tool
    // or actor key the budget was charged to — is the one part that varies by caller, so it is
    // matched loosely here and pinned exactly by the callers that care which subject was charged.
    expect(result.body.error.message).toMatch(
        new RegExp(
            `^Rate limit exceeded for \\S.* \\(${expected.scope}\\)\\. ` +
                `Retry after ${retryAfterHeader} seconds\\.$`,
        ),
    );
    expect(result.body.error.data.scope).toBe(expected.scope);
    expect(result.body.error.data.retryAfterSeconds).toBe(retryAfterHeader);
}
