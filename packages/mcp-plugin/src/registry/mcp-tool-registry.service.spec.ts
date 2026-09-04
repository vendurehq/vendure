import { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { Permission } from '@vendure/common/lib/generated-types';
import { Logger, OrderStateTransitionError, PermissionDefinition, UserInputError } from '@vendure/core';
import { McpStandardSchema, McpToolMetadata, McpToolset } from '@vendure/mcp-sdk';
import { describe, expect, it, vi } from 'vitest';

import { McpRateLimitExceeded } from '../rate-limit/mcp-rate-limiter.service';
import { resolveMcpPluginOptions } from '../resolve-options';
import { McpShopSessionService } from '../shop-session/mcp-shop-session.service';
import { McpPluginOptions } from '../types';

import { McpToolRegistryService } from './mcp-tool-registry.service';
import { McpToolSchemaService } from './mcp-tool-schema.service';

// Type-level: the SDK-local Standard Schema type must satisfy the protocol SDK's type.
const _standardSchemaTypeCheck: StandardSchemaWithJSON = undefined as unknown as McpStandardSchema;
void _standardSchemaTypeCheck;

const rateLimitExceeded = (): McpRateLimitExceeded => ({
    message: 'Rate limit exceeded for x (session). Retry after 30 seconds.',
    retryAfterSeconds: 30,
    scope: 'session',
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
function makeCtx(
    opts: {
        activeUserId?: number;
        granted?: Permission[];
        translate?: (key: string, vars?: any) => string;
    } = {},
) {
    return {
        activeUserId: opts.activeUserId,
        userHasPermissions: (perms: Permission[]) => perms.some(p => (opts.granted ?? []).includes(p)),
        // Stands in for core's RequestContext.translate, including the way it swallows a throw
        // from the translation function. Left off, it returns the key unchanged, which is what
        // core does for a context built without a translation function.
        translate(key: string, vars?: any) {
            try {
                return opts.translate ? opts.translate(key, vars) : key;
            } catch (e: any) {
                return `Translation format error: ${JSON.stringify(e.message)}). Original key: ${key}`;
            }
        },
        // The session swap in McpShopSessionService clones the context via copy().
        copy() {
            return { ...this };
        },
    } as any;
}

function build(
    wrappers: Array<ReturnType<typeof wrapper>>,
    options: McpPluginOptions = {},
    store: Record<string, unknown> = {},
    customPermissions: PermissionDefinition[] = [],
) {
    const discoveryService = {
        getProviders: () => wrappers,
        getMetadataByDecorator: (_dec: unknown, w: any) => w.metadata,
    };
    const settingsStoreService = {
        get: vi.fn((_ctx: unknown, key: string) => Promise.resolve(store[key])),
        set: vi.fn((_ctx: unknown, key: string, value: unknown) => {
            store[key] = value;
            return Promise.resolve({ key, result: true });
        }),
    };
    const rateLimiter = {
        checkRateLimit: vi.fn((): Promise<McpRateLimitExceeded | undefined> => Promise.resolve(undefined)),
    };
    const toolCallLog = {
        logToolCall: vi.fn(() => Promise.resolve(undefined)),
    };
    const sessionService = {
        getSessionFromToken: vi.fn((_token: string) => Promise.resolve(undefined as unknown)),
        createAnonymousSession: vi.fn(() =>
            Promise.resolve({ id: 'anon-id', token: 'anon-token', expires: new Date(Date.now() + 60_000) }),
        ),
    };
    const configService = { authOptions: { customPermissions } };
    const service = new McpToolRegistryService(
        discoveryService as any,
        settingsStoreService as any,
        rateLimiter as any,
        toolCallLog as any,
        new McpToolSchemaService(),
        new McpShopSessionService(sessionService as any),
        configService as any,
        resolveMcpPluginOptions(options),
    );
    return { service, rateLimiter, toolCallLog, settingsStoreService, sessionService, store };
}

const shopTool = (over: Partial<McpToolMetadata> = {}): McpToolMetadata => ({
    name: 'get_thing',
    description: 'Gets a thing',
    toolset: 'shop' as McpToolset,
    behavior: 'readonly',
    permissions: [Permission.Public],
    ...over,
});

const adminTool = (over: Partial<McpToolMetadata> = {}): McpToolMetadata => ({
    name: 'admin_thing',
    description: 'Does an admin thing',
    toolset: 'admin' as McpToolset,
    behavior: 'readonly',
    permissions: [Permission.Authenticated],
    ...over,
});

function specStandardSchema(
    json: Record<string, unknown>,
    validate: (value: unknown) => { value?: unknown; issues?: Array<{ message: string }> },
    outputJson: Record<string, unknown> = json,
) {
    return {
        '~standard': {
            version: 1,
            vendor: 'spec',
            validate,
            jsonSchema: { input: () => json, output: () => outputJson },
        },
    } as any;
}

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

        it('rejects an inputSchema that is neither JSON Schema nor Standard Schema at boot', () => {
            const zodV3Like = { parse: (x: unknown) => x } as any;
            const { service } = build([wrapper(shopTool({ inputSchema: zodV3Like }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /get_thing.*plain JSON Schema object.*or a Standard Schema/,
            );
        });

        it('aborts boot when a schema cannot be compiled (names the tool)', () => {
            // The default validator supports 2020-12, 2019-09, draft-07 and draft-06; any other
            // declared dialect is rejected before compilation.
            const badSchema = {
                type: 'object',
                $schema: 'http://json-schema.org/draft-03/schema#',
                properties: {},
            } as any;
            const { service } = build([wrapper(shopTool({ inputSchema: badSchema }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /MCP tool "get_thing" \(TestModule\) inputSchema failed to compile/,
            );
        });

        it.each(['bad name', 'bad/name'])('rejects the tool name %s at boot', name => {
            const { service } = build([wrapper(shopTool({ name }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(`MCP tool name "${name}"`);
        });

        it('rejects a tool name longer than 128 characters', () => {
            const { service } = build([wrapper(shopTool({ name: 'a'.repeat(129) }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/must contain 1–128/);
        });

        it('rejects a non-string tool name', () => {
            const { service } = build([wrapper(shopTool({ name: null as any }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/MCP tool name/);
        });

        it('rejects a permission that is not a Vendure permission (names it)', () => {
            const { service } = build([
                wrapper(shopTool({ permissions: ['NotARealPermission' as Permission] })),
            ]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /declares unknown permission "NotARealPermission"/,
            );
        });

        it('rejects Permission.Owner, which no MCP caller can satisfy', () => {
            const { service } = build([wrapper(shopTool({ permissions: [Permission.Owner] }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /declares Permission.Owner, which no MCP caller can satisfy/,
            );
        });

        it('accepts a permission registered through authOptions.customPermissions', () => {
            const { service } = build(
                [wrapper(shopTool({ permissions: ['ReadWishlist' as Permission] }))],
                {},
                {},
                [new PermissionDefinition({ name: 'ReadWishlist' })],
            );
            service.onApplicationBootstrap();
            expect(service.getRegistrySnapshot().map(t => t.name)).toEqual(['get_thing']);
        });

        it('rejects an admin tool with no permissions declared (names the tool)', () => {
            const { service } = build([wrapper(adminTool({ permissions: undefined }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /Admin MCP tool "admin_thing" declares no permissions/,
            );
        });

        it('rejects an admin tool with an empty permissions array', () => {
            const { service } = build([wrapper(adminTool({ permissions: [] }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /Admin MCP tool "admin_thing" declares no permissions/,
            );
        });

        it('boots an admin tool that explicitly declares Permission.Public', () => {
            const { service } = build([wrapper(adminTool({ permissions: [Permission.Public] }))]);
            expect(() => service.onApplicationBootstrap()).not.toThrow();
        });

        it('boots a shop tool with no permissions declared (defaults to Public)', () => {
            const { service } = build([wrapper(shopTool({ permissions: undefined }))]);
            expect(() => service.onApplicationBootstrap()).not.toThrow();
        });

        it('rejects usesActiveOrder on an admin tool', () => {
            const { service } = build([wrapper(adminTool({ usesActiveOrder: true }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/usesActiveOrder.*shop tool/);
        });
    });

    describe('Standard Schema authoring', () => {
        const OBJECT_JSON = {
            type: 'object',
            properties: { q: { type: 'string' } },
            required: ['q'],
            additionalProperties: false,
        };
        const DELETE_JSON = {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
            additionalProperties: false,
        };

        it('accepts a Standard Schema inputSchema and derives its JSON Schema at boot', () => {
            const schema = specStandardSchema(OBJECT_JSON, value => ({ value }));
            const { service } = build([wrapper(shopTool({ inputSchema: schema }))]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.jsonInputSchema).toEqual(OBJECT_JSON);
            expect(tool.wireJsonSchema).toEqual(OBJECT_JSON);
        });

        it('prefers the Standard Schema branch when an object carries both ~standard and a top-level type (Valibot shape)', () => {
            const valibotLike = {
                type: 'object', // Valibot schemas carry this at the top level
                ...specStandardSchema(OBJECT_JSON, value => ({ value })),
            };
            const { service } = build([wrapper(shopTool({ inputSchema: valibotLike }))]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.jsonInputSchema).toEqual(OBJECT_JSON);
        });

        it('rejects a validate-only Standard Schema (no JSON Schema conversion) with upgrade guidance', () => {
            const validateOnly = {
                '~standard': { version: 1, vendor: 'spec', validate: (v: unknown) => ({ value: v }) },
            } as any;
            const { service } = build([wrapper(shopTool({ inputSchema: validateOnly }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/cannot emit JSON Schema/);
        });

        it('aborts boot when the converted JSON Schema does not describe an object', () => {
            const schema = specStandardSchema({ type: 'string' }, value => ({ value }));
            const { service } = build([wrapper(shopTool({ inputSchema: schema }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/must describe an object/);
        });

        it('aborts boot when the converted JSON Schema is a top-level union', () => {
            const schema = specStandardSchema({ anyOf: [{ type: 'object' }, { type: 'string' }] }, value => ({
                value,
            }));
            const { service } = build([wrapper(shopTool({ inputSchema: schema }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(
                /is a union \(anyOf\/oneOf\) at the top level/,
            );
        });

        it('aborts boot when the JSON Schema conversion throws (names the tool)', () => {
            const schema = specStandardSchema(OBJECT_JSON, value => ({ value }));
            schema['~standard'].jsonSchema.input = () => {
                throw new Error('unrepresentable');
            };
            const { service } = build([wrapper(shopTool({ inputSchema: schema }))]);
            expect(() => service.onApplicationBootstrap()).toThrow(/could not be converted to JSON Schema/);
        });

        it('passes the parsed value (not the raw args) to the handler', async () => {
            const schema = specStandardSchema(OBJECT_JSON, value => ({
                value: { ...(value as Record<string, unknown>), defaulted: true },
            }));
            const execute = vi.fn((_ctx: unknown, _input: unknown) => ({ ok: true }));
            const { service } = build([wrapper(shopTool({ inputSchema: schema }), execute)]);
            service.onApplicationBootstrap();
            await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'get_thing', { q: 'x' });
            expect(execute).toHaveBeenCalledOnce();
            expect(execute.mock.calls[0][1]).toEqual({ q: 'x', defaulted: true });
        });

        it('injects confirm into the wire schema of a destructive Standard Schema tool but never shows it to the author schema', async () => {
            const strictValidate = (value: unknown) => {
                if (Object.prototype.hasOwnProperty.call(value ?? {}, 'confirm')) {
                    return { issues: [{ message: 'unknown key: confirm' }] };
                }
                return { value };
            };
            const schema = specStandardSchema(DELETE_JSON, strictValidate);
            const execute = vi.fn((_ctx: unknown, _input: unknown) => ({ deleted: true }));
            const { service } = build([
                wrapper(
                    shopTool({ name: 'delete_thing', behavior: 'destructive', inputSchema: schema }),
                    execute,
                ),
            ]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.wireJsonSchema.properties?.confirm).toBeDefined();
            expect(tool.jsonInputSchema.properties?.confirm).toBeUndefined();

            const preview = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'delete_thing', {
                id: 'x',
            });
            expect(preview.structuredContent).toMatchObject({
                status: 'confirmation_required',
                confirmed: false,
            });
            expect(execute).not.toHaveBeenCalled();

            await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'delete_thing', {
                id: 'x',
                confirm: true,
            });
            expect(execute).toHaveBeenCalledOnce();
            expect(execute.mock.calls[0][1]).toEqual({ id: 'x' });
        });

        it('rejects non-boolean confirm on a destructive Standard Schema tool', async () => {
            const schema = specStandardSchema(DELETE_JSON, value => ({ value }));
            const execute = vi.fn();
            const { service } = build([
                wrapper(
                    shopTool({ name: 'delete_thing', behavior: 'destructive', inputSchema: schema }),
                    execute,
                ),
            ]);
            service.onApplicationBootstrap();
            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'delete_thing', {
                id: 'x',
                confirm: 'yes',
            });
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/"confirm" must be a boolean/);
            expect(execute).not.toHaveBeenCalled();
        });

        it('still fails boot when a destructive Standard Schema tool declares its own confirm property', () => {
            const jsonWithConfirm = {
                type: 'object',
                properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
                additionalProperties: false,
            };
            const schema = specStandardSchema(jsonWithConfirm, value => ({ value }));
            const { service } = build([
                wrapper(shopTool({ name: 'delete_thing', behavior: 'destructive', inputSchema: schema })),
            ]);
            expect(() => service.onApplicationBootstrap()).toThrow(/must not declare "confirm"/);
        });

        it('strips a top-level $schema key from derived JSON', () => {
            const jsonWithSchemaKey = {
                ...OBJECT_JSON,
                $schema: 'https://json-schema.org/draft/2020-12/schema',
            };
            const schema = specStandardSchema(jsonWithSchemaKey, value => ({ value }));
            const { service } = build([wrapper(shopTool({ inputSchema: schema }))]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.jsonInputSchema).not.toHaveProperty('$schema');
        });

        it('drift-checks a Standard Schema outputSchema against its derived JSON, not via the author parse', async () => {
            const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            const outputJson = {
                type: 'object',
                properties: { total: { type: 'number' } },
                required: ['total'],
                additionalProperties: false,
            };
            // The author's own validate "fills the default" for a missing `total` — exactly the
            // kind of author-schema behavior that must NOT be used for the post-call drift check,
            // since it would silently mask the handler omitting a required field.
            // Input and output converters return different json so a wrong-direction derivation
            // is caught: compiled from the input side, the permissive `{ type: 'object' }` would
            // accept the handler's `{}` and no drift warning would fire.
            const schema = specStandardSchema(
                { type: 'object' },
                value => ({
                    value: { ...(value as Record<string, unknown>), total: 0 },
                }),
                outputJson,
            );
            const execute = () => ({});
            const { service } = build([wrapper(shopTool({ name: 'totals', outputSchema: schema }), execute)]);
            service.onApplicationBootstrap();
            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'totals', {});
            expect(result.isError).toBeUndefined();
            expect(warn).toHaveBeenCalledWith(
                expect.stringMatching(/does not match its schema/),
                expect.anything(),
            );
            warn.mockRestore();
        });

        it('rejects a destructive Standard Schema tool whose parsed value is not a plain object', async () => {
            const schema = specStandardSchema(DELETE_JSON, () => ({ value: 'x1' }));
            const execute = vi.fn();
            const { service } = build([
                wrapper(
                    shopTool({ name: 'delete_thing', behavior: 'destructive', inputSchema: schema }),
                    execute,
                ),
            ]);
            service.onApplicationBootstrap();
            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'delete_thing', {
                id: 'x1',
                confirm: true,
            });
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/must parse to a plain object/);
            expect(execute).not.toHaveBeenCalled();
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
            // Every role carries Authenticated, so a signed-in caller has it.
            const signedIn = makeCtx({ activeUserId: 1, granted: [Permission.Authenticated] });
            expect(await service.getExposedTools({ ctx: signedIn }, 'shop')).toHaveLength(1);
        });

        it('Public alongside another permission is still callable by anyone', async () => {
            const service = setup([Permission.Public, Permission.ReadCustomer]);
            const ctx = makeCtx();
            expect(await service.getExposedTools({ ctx }, 'shop')).toHaveLength(1);
            const result = await service.callTool({ ctx }, 'shop', 'get_thing', {});
            expect(result.isError).toBeUndefined();
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

        it('throws and keeps the old toggles when the settings store refuses the write', async () => {
            const { service, settingsStoreService } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            const ctx = makeCtx();
            settingsStoreService.set.mockResolvedValueOnce({
                key: 'mcp.toolToggles',
                result: false,
                error: 'read only',
            });

            await expect(service.setToolEnabled(ctx, 'shop', 'get_thing', false)).rejects.toThrow(
                /Could not save the MCP tool toggle for "shop:get_thing": read only/,
            );
            expect(await service.getToolToggles(ctx)).toEqual({});
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

        it('writes the result text as compact JSON', async () => {
            // Indented JSON costs the caller tokens for whitespace no model needs, so the text
            // block is the same document with nothing between the keys.
            const output = { a: 1, b: [1, 2], c: { d: 'e' } };
            const { service } = build([wrapper(shopTool(), () => output)]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            const text = (result.content as any)[0].text;
            expect(text).toBe(JSON.stringify(output));
            expect(text).not.toContain('\n');
        });

        it('reports a Vendure error result returned by a tool as a failed call', async () => {
            // Vendure services answer a refused operation with an error result object instead of
            // throwing. A caller that only reads `isError` must not take that for success, and
            // the error code has to stay readable, so the object itself is the structured content.
            // A class, as core's error results are.
            class OrderModificationError {
                readonly __typename = 'OrderModificationError';
                readonly errorCode = 'ORDER_MODIFICATION_ERROR';
                readonly message = 'The order cannot be modified';
            }
            const fields = {
                __typename: 'OrderModificationError',
                errorCode: 'ORDER_MODIFICATION_ERROR',
                message: 'The order cannot be modified',
            };
            const { service, toolCallLog } = build([wrapper(shopTool(), () => new OrderModificationError())]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toEqual(fields);
            // A plain copy, not the instance: the MCP SDK validates structured content as a record
            // and refuses an object with any other prototype.
            expect(Object.getPrototypeOf(result.structuredContent)).toBe(Object.prototype);
            expect((result.content as any)[0].text).toContain('ORDER_MODIFICATION_ERROR');
            expect(toolCallLog.logToolCall).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'error', output: fields }),
            );
        });

        it('writes a Vendure error result as compact JSON too', async () => {
            class OrderModificationError {
                readonly __typename = 'OrderModificationError';
                readonly errorCode = 'ORDER_MODIFICATION_ERROR';
                readonly message = 'The order cannot be modified';
            }
            const { service } = build([wrapper(shopTool(), () => new OrderModificationError())]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            const text = (result.content as any)[0].text;
            expect(text).toBe(JSON.stringify(result.structuredContent));
            expect(text).not.toContain('\n');
        });
    });

    describe('result size limit', () => {
        const listTool = (over: Partial<McpToolMetadata> = {}) =>
            shopTool({
                name: 'list_things',
                inputSchema: {
                    type: 'object',
                    properties: { limit: { type: 'number' }, filter: { type: 'object' } },
                },
                ...over,
            });

        it('refuses a readonly result over the limit and names the arguments that make it smaller', async () => {
            const { service, toolCallLog } = build([
                wrapper(listTool(), () => ({ big: 'x'.repeat(100_001) })),
            ]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'list_things', {});
            const text = (result.content as any)[0].text;
            expect(result.isError).toBe(true);
            expect(text).toContain('list_things');
            expect(text).toContain('over the 100,000-byte limit');
            expect(text).toContain('"limit"');
            expect(text).toContain('"filter"');
            // The tool has no offset argument, so telling the caller to page by one would be
            // advice it cannot follow.
            expect(text).not.toContain('"offset"');
            // Nothing was returned to the caller, so the call is logged as a failure.
            expect(toolCallLog.logToolCall).toHaveBeenCalledOnce();
            expect(toolCallLog.logToolCall.mock.calls[0][0]).toMatchObject({ status: 'error' });
        });

        it('reports a mutating result over the limit as completed, not as an error', async () => {
            const { service, toolCallLog } = build([
                wrapper(listTool({ name: 'bulk_update', behavior: 'mutating' }), () => ({
                    big: 'x'.repeat(100_001),
                })),
            ]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'bulk_update', {});
            const text = (result.content as any)[0].text;
            expect(result.isError).toBeUndefined();
            expect(text).toContain('The call to "bulk_update" completed');
            expect(text).toContain('Fetch the outcome with a read tool.');
            expect(result.structuredContent).toEqual({ status: 'completed_result_too_large' });
            // The write happened, so the log row is a success carrying the real output.
            expect(toolCallLog.logToolCall).toHaveBeenCalledOnce();
            expect(toolCallLog.logToolCall.mock.calls[0][0]).toMatchObject({ status: 'success' });
        });

        it('logs one error row when the result cannot be serialized', async () => {
            const { service, toolCallLog } = build([wrapper(listTool(), () => ({ count: BigInt(1) }))]);
            service.onApplicationBootstrap();
            const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'list_things', {});

            expect(result.isError).toBe(true);
            expect(toolCallLog.logToolCall).toHaveBeenCalledOnce();
            expect(toolCallLog.logToolCall.mock.calls[0][0]).toMatchObject({ status: 'error' });
            error.mockRestore();
        });

        it('returns a result just under the limit unchanged', async () => {
            const output = { big: 'x'.repeat(99_000) };
            const { service } = build([wrapper(listTool(), () => output)]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'list_things', {});
            expect(result.isError).toBeUndefined();
            expect(result.structuredContent).toEqual(output);
        });

        it('hands the sessionToken back with an oversized cart result', async () => {
            const session = { id: 's1', token: 'existing-token', expires: new Date(Date.now() + 60_000) };
            const { service, sessionService } = build([
                wrapper(
                    listTool({ name: 'touch_cart', behavior: 'mutating', usesActiveOrder: true }),
                    () => ({ big: 'x'.repeat(100_001) }),
                ),
            ]);
            sessionService.getSessionFromToken.mockResolvedValue(session);
            service.onApplicationBootstrap();

            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'touch_cart', {
                sessionToken: 'existing-token',
            });
            expect(result.isError).toBeUndefined();
            expect(result.structuredContent).toEqual({
                status: 'completed_result_too_large',
                sessionToken: 'existing-token',
            });
        });
    });

    describe('rate-limit enforcement', () => {
        it('rate-limits before the existence/toggle/permission checks (denied calls still count)', async () => {
            // A permission-denied call must still consume the bucket; otherwise denied calls cost
            // nothing and can be retried without limit.
            const { service, rateLimiter } = build([
                wrapper(shopTool({ permissions: [Permission.ReadCatalog] })),
            ]);
            service.onApplicationBootstrap();
            rateLimiter.checkRateLimit.mockResolvedValueOnce(rateLimitExceeded());
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(rateLimiter.checkRateLimit).toHaveBeenCalledOnce();
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Rate limit exceeded/);
        });

        it('rate-limits an unknown tool name (bucket consumed before the not-found return)', async () => {
            const { service, rateLimiter } = build([wrapper(shopTool())]);
            service.onApplicationBootstrap();
            await service.callTool({ ctx: makeCtx() }, 'shop', 'no_such_tool', {});
            expect(rateLimiter.checkRateLimit).toHaveBeenCalledWith(
                expect.objectContaining({ endpoint: 'shop', subject: 'no_such_tool' }),
            );
        });

        it('rate-limits search_tools in discovery mode', async () => {
            const { service, rateLimiter } = build([wrapper(shopTool())], {
                toolExposure: 'discovery',
            });
            service.onApplicationBootstrap();
            rateLimiter.checkRateLimit.mockResolvedValueOnce(rateLimitExceeded());
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'search_tools', { query: 'x' });
            expect(rateLimiter.checkRateLimit).toHaveBeenCalledWith(
                expect.objectContaining({ subject: 'search_tools' }),
            );
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Rate limit exceeded/);
        });

        it('rate-limits execute_tool before its unknown-name early return (bucket keyed by the inner tool)', async () => {
            // An unknown inner tool name still consumes a bucket because the limit runs before the
            // not-found return; otherwise the discovery path could be called without limit.
            const { service, rateLimiter } = build([wrapper(shopTool())], {
                toolExposure: 'discovery',
            });
            service.onApplicationBootstrap();
            rateLimiter.checkRateLimit.mockResolvedValueOnce(rateLimitExceeded());
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'execute_tool', {
                name: 'no_such_tool',
                arguments: {},
            });
            expect(rateLimiter.checkRateLimit).toHaveBeenCalledWith(
                expect.objectContaining({ endpoint: 'shop', subject: 'no_such_tool' }),
            );
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/Rate limit exceeded/);
        });
    });

    describe('destructive confirmation', () => {
        const destructive = () =>
            shopTool({
                name: 'delete_thing',
                behavior: 'destructive',
                usesActiveOrder: true,
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
            // Direct mode exposes the tool itself, so the caller re-calls it by name.
            expect((result.content as any)[0].text).toContain('re-call "delete_thing" with "confirm": true');
            expect(execute).not.toHaveBeenCalled();
        });

        it('returns the resolved sessionToken with the confirmation so the confirming call keeps the cart', async () => {
            const session = { id: 's1', token: 'cart-token', expires: new Date(Date.now() + 60_000) };
            const execute = vi.fn();
            const { service, sessionService } = build([wrapper(destructive(), execute)]);
            sessionService.getSessionFromToken.mockResolvedValue(session);
            service.onApplicationBootstrap();

            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'delete_thing', {
                id: 'x',
                sessionToken: 'cart-token',
            });

            expect(result.structuredContent).toEqual({
                status: 'confirmation_required',
                confirmed: false,
                sessionToken: 'cart-token',
            });
            expect(execute).not.toHaveBeenCalled();
        });

        it('starts no session for a confirmation preview called without a token', async () => {
            const execute = vi.fn();
            const { service, sessionService } = build([wrapper(destructive(), execute)]);
            service.onApplicationBootstrap();

            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'delete_thing', {
                id: 'x',
            });

            expect(sessionService.createAnonymousSession).not.toHaveBeenCalled();
            expect(result.structuredContent).toEqual({
                status: 'confirmation_required',
                confirmed: false,
            });
            expect(execute).not.toHaveBeenCalled();
        });

        it('refuses an invalid sessionToken before asking for confirmation', async () => {
            const execute = vi.fn();
            const { service } = build([wrapper(destructive(), execute)]);
            service.onApplicationBootstrap();

            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'delete_thing', {
                id: 'x',
                sessionToken: 'gone',
            });

            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/not valid or has expired/);
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
            expect(() => service.onApplicationBootstrap()).toThrow(/must not declare "confirm"/);
        });
    });

    describe('sessionToken injection (anonymous shop cart identity)', () => {
        const cartTool = (over: Partial<McpToolMetadata> = {}) =>
            shopTool({
                name: 'touch_cart',
                behavior: 'mutating',
                usesActiveOrder: true,
                inputSchema: {
                    type: 'object',
                    properties: { note: { type: 'string' } },
                    additionalProperties: false,
                },
                ...over,
            });

        it('injects sessionToken into the wire schema of a public shop tool, leaving the SSOT clean', () => {
            const { service } = build([wrapper(cartTool())]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.wireJsonSchema.properties?.sessionToken).toMatchObject({ type: 'string' });
            expect(tool.wireJsonSchema.properties?.sessionToken).toMatchObject({
                description:
                    'Session token returned by cart tools. To start a cart, call add_to_cart once without this field. ' +
                    'For later calls, including parallel calls, pass the latest returned token to use the same cart.',
            });
            expect(tool.jsonInputSchema.properties?.sessionToken).toBeUndefined();
        });

        it('leaves an unrelated public mutation sessionless', async () => {
            const { service, sessionService } = build([
                wrapper(shopTool({ name: 'subscribe_to_newsletter', behavior: 'mutating' })),
            ]);
            service.onApplicationBootstrap();

            const tool = service.getRegistrySnapshot()[0];
            expect(tool.wireJsonSchema.properties?.sessionToken).toBeUndefined();

            const result = await service.callToolDirect(
                { ctx: makeCtx() },
                'shop',
                'subscribe_to_newsletter',
                {},
            );
            expect(sessionService.createAnonymousSession).not.toHaveBeenCalled();
            expect(result.structuredContent).toEqual({ ok: true });
        });

        it('does not inject sessionToken for admin tools', () => {
            const { service } = build([wrapper(adminTool())]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.wireJsonSchema.properties?.sessionToken).toBeUndefined();
        });

        it('does not inject sessionToken for a shop tool that requires authentication', () => {
            const { service } = build([
                wrapper(cartTool({ name: 'my_orders', permissions: [Permission.Authenticated] })),
            ]);
            service.onApplicationBootstrap();
            const tool = service.getRegistrySnapshot()[0];
            expect(tool.wireJsonSchema.properties?.sessionToken).toBeUndefined();
        });

        it('fails boot when an anonymous-callable shop tool declares sessionToken in its input or output schema', () => {
            const declaresInInput = cartTool({
                inputSchema: { type: 'object', properties: { sessionToken: { type: 'string' } } },
            });
            const declaresInOutput = cartTool({
                outputSchema: { type: 'object', properties: { sessionToken: { type: 'string' } } },
            });
            for (const tool of [declaresInInput, declaresInOutput]) {
                const { service } = build([wrapper(tool)]);
                expect(() => service.onApplicationBootstrap()).toThrow(/must not declare "sessionToken"/);
            }
        });

        it('strips sessionToken before the handler and the log, and appends the resolved token after both', async () => {
            const session = { id: 's1', token: 'existing-token', expires: new Date(Date.now() + 60_000) };
            const execute = vi.fn((_ctx: unknown, _input: unknown) => ({ ok: true }));
            const { service, sessionService, toolCallLog } = build([wrapper(cartTool(), execute)]);
            sessionService.getSessionFromToken.mockResolvedValue(session);
            service.onApplicationBootstrap();

            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'touch_cart', {
                note: 'hi',
                sessionToken: 'existing-token',
            });

            expect(sessionService.getSessionFromToken).toHaveBeenCalledWith('existing-token');
            expect(execute.mock.calls[0][1]).toEqual({ note: 'hi' });
            // Credential hygiene: the logged input is the stripped one, and the logged output is
            // the handler output from before the append.
            expect(toolCallLog.logToolCall).toHaveBeenCalledWith(
                expect.objectContaining({ input: { note: 'hi' }, output: { ok: true } }),
            );
            expect(result.structuredContent).toEqual({ ok: true, sessionToken: 'existing-token' });
        });

        it('leaves the caller execution context alone when a call resolves its own session', async () => {
            // The transport hands the same execution context to every message in a batch, so a
            // session resolved for one call must not become the next call's starting point.
            const session = { id: 's1', token: 'existing-token', expires: new Date(Date.now() + 60_000) };
            const execute = vi.fn((_ctx: unknown, _input: unknown) => ({ ok: true }));
            const { service, sessionService } = build([wrapper(cartTool(), execute)]);
            sessionService.getSessionFromToken.mockResolvedValue(session);
            service.onApplicationBootstrap();

            const ctx = makeCtx();
            const executionContext = { ctx };
            await service.callToolDirect(executionContext, 'shop', 'touch_cart', { note: 'a' });
            await service.callToolDirect(executionContext, 'shop', 'touch_cart', {
                note: 'b',
                sessionToken: 'existing-token',
            });

            expect(executionContext.ctx).toBe(ctx);
            const tokenCallCtx = execute.mock.calls[1][0] as any;
            expect(tokenCallCtx).not.toBe(ctx);
            expect(tokenCallCtx._session).toBe(session);
        });

        it('creates no session for a readonly tool called without one', async () => {
            const { service, sessionService } = build([
                wrapper(shopTool({ name: 'look' }), () => ({ items: [] })),
            ]);
            service.onApplicationBootstrap();

            const read = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'look', {});
            expect(sessionService.createAnonymousSession).not.toHaveBeenCalled();
            expect(read.structuredContent).toEqual({ items: [] });
        });

        it("refuses a signed-in user's session token", async () => {
            const execute = vi.fn();
            const { service, sessionService } = build([wrapper(cartTool(), execute)]);
            sessionService.getSessionFromToken.mockResolvedValue({
                id: 's2',
                token: 'user-token',
                user: { id: 1 },
            });
            service.onApplicationBootstrap();
            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'touch_cart', {
                sessionToken: 'user-token',
            });
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toMatch(/belongs to a signed-in user/);
            expect(execute).not.toHaveBeenCalled();
        });

        it('appends no sessionToken to the results of an OAuth-authenticated call', async () => {
            const execute = vi.fn(() => ({ ok: true }));
            const { service } = build([wrapper(cartTool(), execute)]);
            service.onApplicationBootstrap();
            const grant = { id: 'g1', oauthClientId: 'c1' } as any;

            const allowed = await service.callToolDirect(
                { ctx: makeCtx({ activeUserId: 1 }), grant },
                'shop',
                'touch_cart',
                {},
            );
            expect(allowed.structuredContent).toEqual({ ok: true });
        });

        it('wraps a non-object result so the sessionToken is never lost', async () => {
            const { service } = build([wrapper(cartTool(), () => ['a', 'b'])]);
            service.onApplicationBootstrap();

            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'touch_cart', {});

            expect(result.structuredContent).toEqual({ result: ['a', 'b'], sessionToken: 'anon-token' });
        });

        it('returns the sessionToken on a failed call so the caller keeps the session it acted on', async () => {
            const execute = vi.fn(() => {
                throw new UserInputError('no such variant');
            });
            const { service, sessionService } = build([wrapper(cartTool(), execute)]);
            service.onApplicationBootstrap();

            const result = await service.callToolDirect({ ctx: makeCtx() }, 'shop', 'touch_cart', {});

            expect(result.isError).toBe(true);
            expect(sessionService.createAnonymousSession).toHaveBeenCalledOnce();
            expect(result.structuredContent).toEqual({ sessionToken: 'anon-token' });
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
            expect(rateLimiter.checkRateLimit).toHaveBeenCalledWith(
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
            // In discovery mode the tool is not exposed by name, so the retry goes through
            // execute_tool rather than a direct re-call.
            const text = (result.content as any)[0].text;
            expect(text).toContain('call "execute_tool" again for "del"');
            expect(text).not.toContain('re-call "del"');
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
            // 'in' is a substring of 'shipping': a substring scorer would match this query,
            // whole-word BM25 with stopword removal must not.
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

    describe('error classification (catch block)', () => {
        it('passes a caller-safe error message through unchanged, and logs it to the tool-call log', async () => {
            const execute = () => {
                throw new UserInputError('bad input from caller');
            };
            const { service, toolCallLog } = build([wrapper(shopTool(), execute)]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toBe('bad input from caller');
            expect(toolCallLog.logToolCall).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'error', output: { message: 'bad input from caller' } }),
            );
        });

        it('genericizes an internal Error for the caller, but logs the real message server-side and to the tool-call log', async () => {
            const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
            const execute = () => {
                throw new Error('database connection refused');
            };
            const { service, toolCallLog } = build([wrapper(shopTool(), execute)]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toBe(
                'The tool failed unexpectedly. This is a server-side fault, not a problem with ' +
                    'your arguments. Do not retry with different arguments; tell the user the ' +
                    'operation could not be completed.',
            );
            expect((result.content as any)[0].text).not.toContain('database connection refused');
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining('database connection refused'),
                expect.anything(),
                expect.anything(),
            );
            // Operator-only data: the real message still lands in the log row regardless of what
            // the caller sees. (The `capture` setting, not this funnel, decides if it's persisted.)
            expect(toolCallLog.logToolCall).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'error',
                    output: { message: 'database connection refused' },
                }),
            );
            error.mockRestore();
        });

        it('treats a thrown non-Error value as internal, using the fallback message', async () => {
            const thrown: unknown = 'oops';
            const execute = () => {
                throw thrown;
            };
            const { service, toolCallLog } = build([wrapper(shopTool(), execute)]);
            service.onApplicationBootstrap();
            const result = await service.callTool({ ctx: makeCtx() }, 'shop', 'get_thing', {});
            expect((result.content as any)[0].text).toBe(
                'The tool failed unexpectedly. This is a server-side fault, not a problem with ' +
                    'your arguments. Do not retry with different arguments; tell the user the ' +
                    'operation could not be completed.',
            );
            expect(toolCallLog.logToolCall).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'error', output: { message: 'MCP tool failed' } }),
            );
        });
    });

    describe('caller-facing error text', () => {
        // Stands in for the request's translate function. i18next runs its ICU formatter on every
        // string it returns, including one it has no entry for, so the fake throws on a brace the
        // way the real formatter would.
        const dictionary: Record<string, (vars: any) => string> = {
            'error.order-does-not-contain-line-with-id': vars =>
                `This order does not contain an OrderLine with the id ${String(vars.id)}`,
            'errorResult.ORDER_STATE_TRANSITION_ERROR': vars =>
                `Cannot transition Order from "${String(vars.fromState)}" to "${String(vars.toState)}"`,
        };
        const translate = (key: string, vars?: any) => {
            if (key.includes('{')) {
                throw new Error('ICU: unexpected brace');
            }
            return dictionary[key] ? dictionary[key](vars) : key;
        };

        const callWith = async (execute: () => unknown, ctx: any) => {
            const { service, toolCallLog } = build([wrapper(shopTool(), execute)]);
            service.onApplicationBootstrap();
            const result = await service.callToolDirect({ ctx }, 'shop', 'get_thing', {});
            return { result, toolCallLog };
        };

        it('translates a core error key and fills in its variables', async () => {
            const { result, toolCallLog } = await callWith(() => {
                throw new UserInputError('error.order-does-not-contain-line-with-id', { id: 999 });
            }, makeCtx({ translate }));

            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toBe(
                'This order does not contain an OrderLine with the id 999',
            );
            // Operators search the log for the stable key, so it is never translated.
            expect(toolCallLog.logToolCall).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'error',
                    output: { message: 'error.order-does-not-contain-line-with-id' },
                }),
            );
        });

        it('leaves the key alone when the context carries no translate function', async () => {
            const { result } = await callWith(() => {
                throw new UserInputError('error.order-does-not-contain-line-with-id', { id: 999 });
            }, makeCtx());

            expect(result.isError).toBe(true);
            expect((result.content as any)[0].text).toBe('error.order-does-not-contain-line-with-id');
        });

        it('reports a formatter failure the way core does, keeping the original sentence', async () => {
            // A plugin sentence with a literal brace makes the ICU formatter throw. Core's
            // RequestContext.translate catches that and returns a diagnostic that still ends
            // with the original text, so the caller can read what went wrong.
            const { result } = await callWith(() => {
                throw new UserInputError('Value {x} is not allowed');
            }, makeCtx({ translate }));

            expect((result.content as any)[0].text).toBe(
                'Translation format error: "ICU: unexpected brace"). Original key: Value {x} is not allowed',
            );
        });

        it('keeps a plain sentence that has no translation', async () => {
            const { result } = await callWith(() => {
                throw new UserInputError('There is no active cart. Add an item with add_to_cart first.');
            }, makeCtx({ translate }));

            expect((result.content as any)[0].text).toBe(
                'There is no active cart. Add an item with add_to_cart first.',
            );
        });

        it('translates the message of a Vendure error result, using its fields as the variables', async () => {
            const { result, toolCallLog } = await callWith(
                () =>
                    new OrderStateTransitionError({
                        fromState: 'AddingItems',
                        toState: 'ArrangingPayment',
                        transitionError: 'x',
                    }),
                makeCtx({ translate }),
            );

            expect(result.isError).toBe(true);
            expect((result.structuredContent as any).message).toBe(
                'Cannot transition Order from "AddingItems" to "ArrangingPayment"',
            );
            expect((result.structuredContent as any).errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
            expect(toolCallLog.logToolCall).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'error',
                    output: expect.objectContaining({ message: 'ORDER_STATE_TRANSITION_ERROR' }),
                }),
            );
        });

        it('keeps the original message of an error result core has no translation for', async () => {
            const { result } = await callWith(
                () => ({
                    __typename: 'MyError',
                    errorCode: 'MY_ERROR',
                    message: 'MY_ERROR',
                }),
                makeCtx({ translate }),
            );

            expect(result.isError).toBe(true);
            expect((result.structuredContent as any).message).toBe('MY_ERROR');
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
