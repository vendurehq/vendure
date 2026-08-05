import { Permission } from '@vendure/common/lib/generated-types';
import { Logger } from '@vendure/core';
import { McpToolMetadata, McpToolset } from '@vendure/mcp-sdk';
import { describe, expect, it, vi } from 'vitest';

import { McpRateLimitExceededError } from '../rate-limit/mcp-rate-limiter.service';
import { McpPluginOptions } from '../types';

import { McpToolRegistryService } from './mcp-tool-registry.service';

const rateLimitError = () =>
    new McpRateLimitExceededError({
        message: 'Rate limit exceeded for x (session). Retry after 30 seconds.',
        retryAfterSeconds: 30,
        scope: 'session',
        subject: 'x',
    });

/** Builds a fake Nest InstanceWrapper carrying `@McpTool` metadata and an execute() spy. */
function wrapper(metadata: McpToolMetadata, execute: (...args: any[]) => any = () => ({ ok: true })) {
    return {
        instance: { execute },
        metadata,
        name: metadata.name,
        host: { metatype: { name: 'TestModule' } },
    };
}

/** Mock RequestContext with OR permission semantics. */
function makeCtx(opts: { activeUserId?: number; granted?: Permission[] } = {}) {
    return {
        activeUserId: opts.activeUserId,
        userHasPermissions: (perms: Permission[]) => perms.some(p => (opts.granted ?? []).includes(p)),
    } as any;
}

function build(
    wrappers: Array<ReturnType<typeof wrapper>>,
    options: McpPluginOptions = {},
    store: Record<string, unknown> = {},
) {
    const discoveryService = {
        getProviders: () => wrappers,
        getMetadataByDecorator: (_dec: unknown, w: any) => w.metadata,
    };
    const settingsStoreService = {
        get: vi.fn((_ctx: unknown, key: string) => Promise.resolve(store[key])),
        set: vi.fn((_ctx: unknown, key: string, value: unknown) => {
            store[key] = value;
            return Promise.resolve();
        }),
    };
    const rateLimiter = {
        enforceRateLimit: vi.fn(() => Promise.resolve(undefined)),
    };
    const toolCallLog = {
        logToolCall: vi.fn(() => Promise.resolve(undefined)),
    };
    const service = new McpToolRegistryService(
        discoveryService as any,
        settingsStoreService as any,
        rateLimiter as any,
        toolCallLog as any,
        options,
    );
    return { service, rateLimiter, toolCallLog, settingsStoreService, store };
}

const shopTool = (over: Partial<McpToolMetadata> = {}): McpToolMetadata => ({
    name: 'get_thing',
    description: 'Gets a thing',
    toolset: 'shop' as McpToolset,
    behavior: 'readonly',
    permissions: [Permission.Public],
    ...over,
});

describe('McpToolRegistryService', () => {
    describe('discovery + bootstrap gate', () => {
        it('discovers @McpTool providers keyed by toolset:name', () => {
            const { service } = build([wrapper(shopTool()), wrapper(shopTool({ name: 'other' }))]);
            service.onApplicationBootstrap();
            expect(
                service
                    .getRegistrySnapshot()
                    .map(t => t.name)
                    .sort(),
            ).toEqual(['get_thing', 'other']);
        });

        it('hard-errors on a duplicate toolset:name', () => {
            const { service } = build([wrapper(shopTool()), wrapper(shopTool())]);
            expect(() => service.onApplicationBootstrap()).toThrow(/Duplicate MCP tool name "get_thing"/);
        });

        it('rejects a tool that reuses a reserved discovery meta-tool name', () => {
            const { service } = build([wrapper(shopTool({ name: 'search_tools' }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/reserved for discovery/);
        });

        it('defaults a missing inputSchema to the no-args schema (accepts nothing)', () => {
            const { service } = build([wrapper(shopTool({ inputSchema: undefined }))]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.jsonInputSchema).toEqual({
                type: 'object',
                properties: {},
                additionalProperties: false,
            });
        });

        it('rejects a non-JSON-Schema inputSchema at boot (JSON Schema or bust)', () => {
            const zodLike = { parse: (x: unknown) => x } as any;
            const { service } = build([wrapper(shopTool({ inputSchema: zodLike }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/get_thing.*JSON Schema or bust/);
        });

        it('aborts boot when a schema cannot be compiled (names the tool)', () => {
            // The default validator supports 2020-12, 2019-09, draft-07 and draft-06; any other
            // declared dialect is rejected before compilation, which is what we're testing here.
            const badSchema = {
                type: 'object',
                $schema: 'http://json-schema.org/draft-03/schema#',
                properties: {},
            } as any;
            const { service } = build([wrapper(shopTool({ inputSchema: badSchema }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /get_thing inputSchema.*failed to compile/,
            );
        });
    });

    describe('permissions (OR + sole short-circuit)', () => {
        const setup = (permissions: Permission[]) => {
            const { service } = build([wrapper(shopTool({ permissions }))]);
            service.onApplicationBootstrap();
            return service;
        };

        it('sole Public is visible to anonymous callers', async () => {
            const service = setup([Permission.Public]);
            const tools = await service.getExposedTools({ ctx: makeCtx() }, 'shop');
            expect(tools).toHaveLength(1);
        });

        it('empty permissions are treated as Public', async () => {
            const service = setup([]);
            const tools = await service.getExposedTools({ ctx: makeCtx() }, 'shop');
            expect(tools).toHaveLength(1);
        });

        it('sole Authenticated requires an active user', async () => {
            const service = setup([Permission.Authenticated]);
            expect(await service.getExposedTools({ ctx: makeCtx() }, 'shop')).toHaveLength(0);
            expect(await service.getExposedTools({ ctx: makeCtx({ activeUserId: 1 }) }, 'shop')).toHaveLength(
                1,
            );
        });

        it('fine-grained permissions use OR semantics', async () => {
            const service = setup([Permission.ReadCatalog, Permission.ReadOrder]);
            expect(await service.getExposedTools({ ctx: makeCtx() }, 'shop')).toHaveLength(0);
            expect(
                await service.getExposedTools({ ctx: makeCtx({ granted: [Permission.ReadOrder] }) }, 'shop'),
            ).toHaveLength(1);
        });
    });

    describe('toggles', () => {
        it('is enabled by default and hidden/blocked once disabled', async () => {
            const { service } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            const ctx = makeCtx();
            expect(await service.getExposedTools({ ctx }, 'shop')).toHaveLength(1);

            await service.setToolEnabled(ctx, 'shop', 'get_thing', false);
            expect(await service.getExposedTools({ ctx }, 'shop')).toHaveLength(0);

            const result = await service.callTool({ ctx }, 'shop', 'get_thing', {});
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/disabled/);
        });
    });

    describe('toggle cache (per RequestContext)', () => {
        it('reads the settings store once for two getToolToggles calls with the same ctx', async () => {
            const { service, settingsStoreService } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            const ctx = makeCtx();

            await service.getToolToggles(ctx);
            await service.getToolToggles(ctx);

            expect(settingsStoreService.get).toHaveBeenCalledOnce();
        });

        it('reads the settings store once per ctx when different ctx objects are used', async () => {
            const { service, settingsStoreService } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            const ctxA = makeCtx();
            const ctxB = makeCtx();

            await service.getToolToggles(ctxA);
            await service.getToolToggles(ctxB);

            expect(settingsStoreService.get).toHaveBeenCalledTimes(2);
        });

        it('makes a write from one ctx visible to another ctx that already cached toggles', async () => {
            const { service } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            const ctxA = makeCtx();
            const ctxB = makeCtx();

            // ctxA populates its cache entry before ctxB writes.
            await service.getToolToggles(ctxA);
            await service.setToolEnabled(ctxB, 'shop', 'get_thing', false);

            expect(await service.getToolToggles(ctxA)).toEqual({ 'shop:get_thing': false });
        });
    });

    describe('exposure modes', () => {
        it('direct mode exposes the direct tools', async () => {
            const { service } = build([wrapper(shopTool())], { toolExposure: 'direct' });
            service.onApplicationBootstrap();
            const tools = await service.getExposedTools({ ctx: makeCtx() }, 'shop');
            expect(tools.map(t => t.name)).toEqual(['get_thing']);
        });

        it('discovery mode exposes exactly search_tools and execute_tool', async () => {
            const { service } = build([wrapper(shopTool())], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const tools = await service.getExposedTools({ ctx: makeCtx() }, 'shop');
            expect(tools.map(t => t.name).sort()).toEqual(['execute_tool', 'search_tools']);
        });
    });

    describe('call-time re-checks', () => {
        it('denies a call the caller lacks permission for', async () => {
            const { service } = build([wrapper(shopTool({ permissions: [Permission.ReadCatalog] }))]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/permission/);
        });

        it('runs a permitted tool end-to-end and returns structuredContent', async () => {
            const execute = vi.fn(() => ({ items: [] }));
            const { service } = build([wrapper(shopTool(), execute)]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(execute).toHaveBeenCalledOnce();
            expect(result.structuredContent).toEqual({ items: [] });
        });
    });

    describe('rate-limit enforcement', () => {
        it('rate-limits before the existence/toggle/permission checks (denied calls still count)', async () => {
            // A permission-denied call must still consume the bucket — otherwise it is a free hammer.
            const { service, rateLimiter } = build([
                wrapper(shopTool({ permissions: [Permission.ReadCatalog] })),
            ]);
            service.onApplicationBootstrap();
            rateLimiter.enforceRateLimit.mockRejectedValueOnce(rateLimitError());
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(rateLimiter.enforceRateLimit).toHaveBeenCalledOnce();
            // The rate-limit result wins over the permission error because it runs first.
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Rate limit exceeded/);
        });

        it('rate-limits an unknown tool name (bucket consumed before the not-found return)', async () => {
            const { service, rateLimiter } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            await service.callTool({ ctx: makeCtx() }, 'shop', 'no_such_tool', {});
            expect(rateLimiter.enforceRateLimit).toHaveBeenCalledWith(
                expect.objectContaining({ endpoint: 'shop', subject: 'no_such_tool' }),
            );
        });

        it('rate-limits search_tools in discovery mode', async () => {
            const { service, rateLimiter } = build([wrapper(shopTool())], {
                toolExposure: 'discovery',
            });
            service.onApplicationBootstrap();
            rateLimiter.enforceRateLimit.mockRejectedValueOnce(rateLimitError());
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', { query: 'x' });
            expect(rateLimiter.enforceRateLimit).toHaveBeenCalledWith(
                expect.objectContaining({ subject: 'search_tools' }),
            );
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Rate limit exceeded/);
        });

        it('rate-limits execute_tool before its unknown-name early return (bucket keyed by the inner tool)', async () => {
            // The discovery funnel must not be a rate-limit-free hammer: an unknown inner tool name
            // still consumes a bucket because the limit runs before the not-found return.
            const { service, rateLimiter } = build([wrapper(shopTool())], {
                toolExposure: 'discovery',
            });
            service.onApplicationBootstrap();
            rateLimiter.enforceRateLimit.mockRejectedValueOnce(rateLimitError());
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'no_such_tool',
                arguments: {},
            });
            expect(rateLimiter.enforceRateLimit).toHaveBeenCalledWith(
                expect.objectContaining({ endpoint: 'shop', subject: 'no_such_tool' }),
            );
            // Rate-limit result wins over the not-found error because it runs first.
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Rate limit exceeded/);
        });
    });

    describe('destructive confirmation', () => {
        const destructive = () =>
            shopTool({
                name: 'delete_thing',
                behavior: 'destructive',
                inputSchema: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                    additionalProperties: false,
                },
            });

        it('returns confirmation_required without confirm and does not call the handler', async () => {
            const execute = vi.fn();
            const { service } = build([wrapper(destructive(), execute)]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'delete_thing', { id: 'x' });
            expect(result.isError).toBeUndefined();
            expect(result.structuredContent).toMatchObject({
                status: 'confirmation_required',
                confirmed: false,
            });
            expect(execute).not.toHaveBeenCalled();
        });

        it('calls the handler with confirm stripped when confirm:true', async () => {
            const execute = vi.fn((_ctx: unknown, _input: unknown) => ({ deleted: true }));
            const { service } = build([wrapper(destructive(), execute)]);
            service.onApplicationBootstrap();
            await service.callTool({ ctx: makeCtx() }, 'shop', 'delete_thing', { id: 'x', confirm: true });
            expect(execute).toHaveBeenCalledOnce();
            expect(execute.mock.calls[0][1]).toEqual({ id: 'x' });
        });

        it('leaves the SSOT schema free of the injected confirm (clone proof)', () => {
            const { service } = build([wrapper(destructive())]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot().find(t => t.name === 'delete_thing');
            expect(tool).toBeDefined();
            expect(tool?.jsonInputSchema.properties?.confirm).toBeUndefined();
        });

        it('fails boot when a destructive tool declares its own confirm property', () => {
            const tool = shopTool({
                name: 'delete_thing',
                behavior: 'destructive',
                inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
            });
            const { service } = build([wrapper(tool)]);
            expect(() => service.onApplicationBootstrap()).toThrow(/must not declare its own\s+"confirm"/);
        });
    });

    describe('discovery-path inner-input validation', () => {
        const target = () =>
            shopTool({
                name: 'echo',
                inputSchema: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                    additionalProperties: false,
                },
            });

        it('rejects execute_tool inner arguments that violate the target schema, before the handler', async () => {
            const execute = vi.fn(() => ({ ok: true }));
            const { service, rateLimiter } = build([wrapper(target(), execute)], {
                toolExposure: 'discovery',
            });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'echo',
                arguments: { text: 123 },
            });
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Invalid arguments for tool "echo"/);
            expect(execute).not.toHaveBeenCalled();
            // Even an invalid-args call consumes a bucket (keyed by the inner tool), before it errors.
            expect(rateLimiter.enforceRateLimit).toHaveBeenCalledWith(
                expect.objectContaining({ endpoint: 'shop', subject: 'echo' }),
            );
        });

        it('rejects an unknown/extra inner property (additionalProperties:false)', async () => {
            const execute = vi.fn(() => ({ ok: true }));
            const { service } = build([wrapper(target(), execute)], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'echo',
                arguments: { text: 'hi', bogus: 1 },
            });
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Invalid arguments for tool "echo"/);
            expect(execute).not.toHaveBeenCalled();
        });

        it('rejects inner arguments missing a required property', async () => {
            const execute = vi.fn(() => ({ ok: true }));
            const { service } = build([wrapper(target(), execute)], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'echo',
                arguments: {},
            });
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Invalid arguments for tool "echo"/);
            expect(execute).not.toHaveBeenCalled();
        });

        it('runs the target when inner arguments are valid', async () => {
            const execute = vi.fn(() => ({ echoed: 'hi' }));
            const { service } = build([wrapper(target(), execute)], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'echo',
                arguments: { text: 'hi' },
            });
            expect(execute).toHaveBeenCalledOnce();
            expect(result.structuredContent).toEqual({ echoed: 'hi' });
        });

        it('accepts confirm:true for a destructive target via discovery and strips it before the handler', async () => {
            // The trap: the funnel must validate `confirm` against the WIRE schema (which has it),
            // not the canonical schema (additionalProperties:false, which would reject it).
            const execute = vi.fn((_ctx: unknown, _input: unknown) => ({ deleted: true }));
            const destructiveTarget = shopTool({
                name: 'del',
                behavior: 'destructive',
                inputSchema: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                    additionalProperties: false,
                },
            });
            const { service } = build([wrapper(destructiveTarget, execute)], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'del',
                arguments: { id: 'x', confirm: true },
            });
            expect(execute).toHaveBeenCalledOnce();
            expect(execute.mock.calls[0][1]).toEqual({ id: 'x' });
            expect(result.structuredContent).toEqual({ deleted: true });
        });

        it('returns confirmation_required for a destructive target via discovery without confirm', async () => {
            const execute = vi.fn();
            const destructiveTarget = shopTool({
                name: 'del',
                behavior: 'destructive',
                inputSchema: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                    additionalProperties: false,
                },
            });
            const { service } = build([wrapper(destructiveTarget, execute)], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'del',
                arguments: { id: 'x' },
            });
            expect(result.structuredContent).toMatchObject({
                status: 'confirmation_required',
                confirmed: false,
            });
            expect(execute).not.toHaveBeenCalled();
        });
    });

    describe('search_tools', () => {
        it('returns a fallback hint on zero results', async () => {
            const { service } = build([wrapper(shopTool())], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'zzznomatch',
            });
            expect(result.structuredContent).toMatchObject({ tools: [] });
            expect((result.structuredContent as any).hint).toContain('No shop tools matched');
        });

        it('returns matching summaries carrying the wire schema', async () => {
            // get_thing is non-destructive, so its wire schema equals its canonical schema
            // (no injected confirm) — the destructive case is covered separately below.
            const { service } = build([wrapper(shopTool())], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'thing',
            });
            const tools = (result.structuredContent as any).tools;
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('get_thing');
            expect(tools[0].inputSchema.properties.confirm).toBeUndefined();
        });

        it('for a destructive tool, the summary carries the injected confirm while the SSOT schema stays clean', async () => {
            const destructiveTool = shopTool({
                name: 'delete_thing',
                behavior: 'destructive',
                inputSchema: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                    additionalProperties: false,
                },
            });
            const { service } = build([wrapper(destructiveTool)], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();

            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'thing',
            });
            const tools = (result.structuredContent as any).tools;
            expect(tools).toHaveLength(1);
            expect(tools[0].inputSchema.properties.confirm).toBeDefined();

            const registered = service.getRegistrySnapshot().find(t => t.name === 'delete_thing');
            expect(registered?.jsonInputSchema.properties?.confirm).toBeUndefined();
        });

        it('matches author keywords in the search query', async () => {
            const { service } = build(
                [
                    wrapper(
                        shopTool({
                            name: 'refund_order',
                            description: 'Refund the first refundable payment for an order.',
                            keywords: ['money back', 'reimburse'],
                        }),
                    ),
                ],
                { toolExposure: 'discovery' },
            );
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'money back',
            });
            const tools = (result.structuredContent as any).tools;
            expect(tools.map((t: any) => t.name)).toContain('refund_order');
        });

        it('never serializes keywords into search_tools results (search-only metadata)', async () => {
            const { service } = build([wrapper(shopTool({ keywords: ['hidden phrase'] }))], {
                toolExposure: 'discovery',
            });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'hidden',
            });
            const tools = (result.structuredContent as any).tools;
            expect(tools).toHaveLength(1);
            expect(tools[0].keywords).toBeUndefined();
        });

        it('does not match tokens that only appear in the provider module name', async () => {
            // wrapper() sets pluginSource to 'TestModule'; the tool's own text contains no such token.
            const { service } = build([wrapper(shopTool())], { toolExposure: 'discovery' });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'testmodule',
            });
            expect((result.structuredContent as any).tools).toEqual([]);
            expect((result.structuredContent as any).hint).toContain('No shop tools matched');
        });

        it('ranks a tool matching a rare query word above one matching only common words', async () => {
            const { service } = build(
                [
                    wrapper(
                        shopTool({ name: 'refund_order', description: 'Refund a payment for an order.' }),
                    ),
                    wrapper(
                        shopTool({ name: 'list_orders', description: 'List orders placed in the store.' }),
                    ),
                ],
                { toolExposure: 'discovery' },
            );
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'refund an order',
            });
            const names = (result.structuredContent as any).tools.map((t: any) => t.name);
            expect(names[0]).toBe('refund_order');
        });

        it('returns the fallback hint for a stopword-only query instead of matching everything', async () => {
            // 'in' is a substring of 'shipping' — the old substring scorer matched it (+3+1); BM25's
            // whole-word tokenizer drops stopwords entirely, so this query must yield the hint.
            const { service } = build(
                [wrapper(shopTool({ description: 'Sets the shipping method for the cart.' }))],
                { toolExposure: 'discovery' },
            );
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: 'in the',
            });
            expect((result.structuredContent as any).tools).toEqual([]);
            expect((result.structuredContent as any).hint).toContain('No shop tools matched');
        });

        it('empty query lists visible tools by name', async () => {
            const { service } = build([wrapper(shopTool()), wrapper(shopTool({ name: 'other_thing' }))], {
                toolExposure: 'discovery',
            });
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', { query: '' });
            const names = (result.structuredContent as any).tools.map((t: any) => t.name);
            expect(names).toEqual(['get_thing', 'other_thing']);
        });

        // An empty query does NOT list everything: it is clamped to `limit` like any other query.
        // Nothing covered this, which is how the "lists everything" claim survived in the docs and
        // in the zero-result hint.
        it('empty query is clamped to limit rather than listing everything', async () => {
            const many = Array.from({ length: 12 }, (_, i) =>
                wrapper(shopTool({ name: `tool_${String(i).padStart(2, '0')}` })),
            );
            const { service } = build(many, { toolExposure: 'discovery' });
            service.onApplicationBootstrap();

            const defaulted = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: '',
            });
            expect((defaulted.structuredContent as any).tools).toHaveLength(10);

            const raised = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', {
                query: '',
                limit: 50,
            });
            expect((raised.structuredContent as any).tools).toHaveLength(12);
        });
    });

    describe('output drift', () => {
        it('logs a warning but still succeeds when output does not match a declared outputSchema', async () => {
            const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            const execute = () => ({ count: 'not-a-number' });
            const { service } = build([
                wrapper(
                    shopTool({
                        name: 'counts',
                        outputSchema: {
                            type: 'object',
                            properties: { count: { type: 'number' } },
                            required: ['count'],
                        },
                    }),
                    execute,
                ),
            ]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'counts', {});
            expect(result.isError).toBeUndefined();
            expect(warn).toHaveBeenCalledWith(
                expect.stringMatching(/does not match its schema/),
                expect.anything(),
            );
            warn.mockRestore();
        });
    });

    describe('instrumentation (@Instrument())', () => {
        it('constructs and dispatches callTool with instrumentation disabled and no telemetry plugin', async () => {
            const { service, toolCallLog } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(result.isError).toBeUndefined();
            expect(toolCallLog.logToolCall).toHaveBeenCalledOnce();
        });
    });
});
