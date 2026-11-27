import { DiscoveryService } from '@nestjs/core';
import type { Permission } from '@vendure/common/lib/generated-types';
import type { ID, RequestContext } from '@vendure/core';

import { McpStandardSchema } from './standard-schema';
import { McpToolBehavior, McpToolset } from './types';

/**
 * @description
 * A JSON Schema for a tool's input or output. Only object types are described here;
 * any other JSON Schema keywords can be added via the index signature.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export interface McpJsonSchema {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    /**
     * @description
     * Room for any other JSON Schema keyword, such as `additionalProperties`. Schemas are
     * compiled as JSON Schema 2020-12, so leave out `$schema`.
     */
    [key: string]: unknown;
}

/**
 * @description
 * A tool input/output schema in either accepted form: a plain JSON Schema object
 * ({@link McpJsonSchema}), or a Standard Schema object with JSON Schema conversion
 * ({@link McpStandardSchema}, e.g. a Zod v4 schema).
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export type McpToolSchema = McpJsonSchema | McpStandardSchema;

/**
 * @description
 * Describes a single MCP tool. Attach this to a class with the {@link McpTool} decorator; the MCP
 * server finds those classes on startup and exposes each one to agents.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export interface McpToolMetadata {
    /**
     * @description
     * The name of the tool, unique within its toolset, in snake_case, e.g. `search_products`.
     * The names `search_tools` and `execute_tool` are reserved for the discovery meta-tools.
     * The server refuses to start if a tool takes a reserved name, or a name already used in
     * the same toolset.
     */
    name: string;
    /**
     * @description
     * A short title for people to read, passed to the client and indexed for `search_tools`
     * queries.
     */
    title?: string;
    /**
     * @description
     * A plain description of what the tool does, written for an AI agent to read. It is sent to
     * the client with the tool list, and indexed for `search_tools` queries. For a destructive
     * tool without a `describe` method it is the preview the caller is asked to consent to.
     */
    description: string;
    /**
     * @description
     * Extra search terms for the tool: synonyms and phrasings a user would actually say, e.g.
     * `['money back', 'reimburse']` for a refund tool. They are indexed with the name, title and
     * description to match `search_tools` queries in discovery mode. `tools/list` also carries
     * them in each tool's `_meta`, under `vendure.io/keywords`, so a client that builds its own
     * tool search can use them. They are never returned in a tool result.
     */
    keywords?: string[];
    /**
     * @description
     * A `shop` tool appears on the MCP shop endpoint, an `admin` tool on the admin endpoint.
     * Names only have to be unique within one toolset.
     */
    toolset: McpToolset;
    /**
     * @description
     * The permissions needed to call the tool. The caller only needs one of them, the same OR
     * logic as the `Allow` decorator.
     *
     * On a `shop` tool, omitting this or passing an empty array makes the tool public: every
     * caller passes the permission check, including anonymous ones.
     *
     * On an `admin` tool it is required. The server refuses to start when it is omitted or empty.
     * Use `[Permission.Authenticated]` if any signed-in administrator may call the tool.
     */
    permissions?: Permission[];
    /**
     * @description
     * How the tool behaves, which decides how it is exposed to the agent:
     *
     * - `readonly`: the tool changes nothing. Its `readOnlyHint` and `idempotentHint`
     *   annotations are set to true.
     * - `mutating`: the tool writes data and runs immediately.
     * - `destructive`: the tool writes data and must be confirmed first. Its `destructiveHint`
     *   annotation is set to true. An optional string `confirm` field is added to the input schema
     *   the caller sees. A call without a matching `confirm` does not run the tool. It returns an
     *   `incomplete` result instead, with a preview of the action and a `consent` need that
     *   carries a digest. The caller runs the tool again with `confirm` set to that digest. See
     *   {@link McpToolHandler.describe} for the preview. A destructive tool must not declare a
     *   `confirm` property of its own.
     *
     * @default 'mutating'
     */
    behavior?: McpToolBehavior;
    /**
     * @description
     * Set to `true` for Shop tools that use the shopper's active Order. This enables anonymous
     * callers to continue the same cart using a `sessionToken`.
     *
     * When the shopper already has a cart, `ctx.currencyCode` is the cart's currency instead of the
     * channel's default, so changes to the cart keep its currency and prices.
     *
     * Only valid for Shop tools. The `sessionToken` field is managed automatically.
     *
     * @default false
     */
    usesActiveOrder?: boolean;
    /**
     * @description
     * The schema for the tool's arguments. Two forms are accepted: a plain JSON Schema object
     * ({@link McpJsonSchema}), or a Standard Schema object that can emit JSON Schema
     * ({@link McpStandardSchema}), such as a Zod v4 schema. The registry compiles the schema once
     * at startup, and validates every call's arguments against it. A tool that omits it takes no
     * arguments.
     */
    inputSchema?: McpToolSchema;
    /**
     * @description
     * The schema for the tool's return value, in the same two forms as `inputSchema`. The registry
     * validates each result against it and logs a warning on a mismatch. The call still succeeds,
     * and the schema is not advertised to the client.
     */
    outputSchema?: McpToolSchema;
}

/**
 * @description
 * The MCP OAuth grant behind a tool call, when the call arrived over MCP OAuth.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export interface McpCallerGrant {
    id: ID;
    /**
     * @description
     * Identifies the app that connected, rather than the person using it.
     */
    oauthClientId: ID;
}

/**
 * @description
 * Who is calling a tool and how. Passed as the optional third argument to
 * {@link McpToolHandler.execute}.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export interface McpCallerInfo {
    /**
     * @description
     * The OAuth grant behind the call. It is set for every call that arrived via MCP OAuth, and
     * undefined for anonymous shop calls and in-process calls.
     */
    grant?: McpCallerGrant;
    /**
     * @description
     * The client IP resolved by the HTTP transport. It is set for every HTTP call, and undefined
     * for in-process calls.
     */
    clientIp?: string;
    /**
     * @description
     * True when the call arrived with the local-trust secret of a dev server that the Vendure CLI
     * started, rather than over OAuth. Such a call acts as the superadmin and has no grant, so a
     * tool that keeps state on the grant must keep it somewhere else, or hand it back to the
     * caller.
     *
     * @since 4.0.0
     */
    localTrust?: boolean;
}

/**
 * @description
 * The shape of an MCP tool class: an `execute` method that the server calls with the
 * {@link RequestContext}, the input, and, when a tool needs to know who is calling,
 * {@link McpCallerInfo}.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export interface McpToolHandler<I = unknown, O = unknown> {
    /**
     * @description
     * The tool's implementation. The server calls it with a {@link RequestContext} for the caller,
     * the validated input, and {@link McpCallerInfo}. The caller info is always passed, though the
     * parameter is optional so a tool that ignores it can leave it out. Whatever the method
     * returns becomes the tool's result.
     */
    execute(ctx: RequestContext, input: I, caller?: McpCallerInfo): Promise<O> | O;
    /**
     * @description
     * Describes what a `destructive` tool would do with this input, as a short plain-text summary
     * that names the resolved target, for example `Cancel order AB123 (id 42), 3 lines, 120.00 EUR`.
     * The server calls it before the tool runs and returns the text as the preview of the
     * `incomplete` result that asks the caller for consent. It must not change any data.
     *
     * The consent digest covers the preview, so when the target changes between the preview and
     * the confirming call, the digest no longer matches and the caller is asked again. Throw a
     * caller-safe error, such as `UserInputError`, when the target does not exist.
     *
     * Optional. Without it, the preview is the tool's description and the input as JSON. It is
     * never called for a tool that is not `destructive`.
     *
     * @since 4.0.0
     */
    describe?(ctx: RequestContext, input: I, caller?: McpCallerInfo): Promise<string> | string;
}

/**
 * @description
 * Marks a class as an MCP tool. The class must be a NestJS provider (can be injected via `@Injectable()`)
 * so the MCP server can discover it and inject the services it depends on.
 * It also needs an `execute` method (see {@link McpToolHandler}), which the server checks for when registering the
 * tool. The {@link McpToolMetadata} you pass is read at runtime and used by the
 * [MCP plugin](/reference/core-plugins/mcp-plugin/) to turn the class into a
 * callable tool.
 *
 * @example
 * ```ts
 * import { Injectable } from '\@nestjs/common';
 * import { McpTool, McpToolHandler } from '\@vendure/mcp-sdk';
 * import { Permission, RequestContext } from '\@vendure/core';
 *
 * \@Injectable()
 * \@McpTool({
 *     name: 'search_products',
 *     description: 'Search the product catalog',
 *     toolset: 'shop',
 *     behavior: 'readonly',
 *     permissions: [Permission.Public],
 * })
 * export class SearchProductsTool implements McpToolHandler {
 *     execute(ctx: RequestContext, input: { term: string }) {
 *         // ...
 *         return { items: [] };
 *     }
 * }
 * ```
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const McpTool = DiscoveryService.createDecorator<McpToolMetadata>();
