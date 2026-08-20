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
 * @docsCategory core plugins/McpPlugin
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
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export type McpToolSchema = McpJsonSchema | McpStandardSchema;

/**
 * @description
 * Describes a single MCP tool. You attach this to a class with the {@link McpTool}
 * decorator. The MCP server finds those classes on startup and exposes each one as a
 * callable tool.
 *
 * @docsCategory core plugins/McpPlugin
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
     * tool it is repeated in the confirmation prompt.
     */
    description: string;
    /**
     * @description
     * Extra search terms for the tool: synonyms and phrasings a user would actually say, e.g.
     * `['money back', 'reimburse']` for a refund tool. They are indexed with the name, title and
     * description to match `search_tools` queries in discovery mode. They are never shown to the
     * agent or returned in a tool result.
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
     *   annotation is set to true. An optional `confirm` field is added to the input schema the
     *   caller sees. The registry refuses to run the tool unless the call passes `confirm: true`.
     *   A destructive tool must not declare a `confirm` property of its own.
     *
     * @default 'mutating'
     */
    behavior?: McpToolBehavior;
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
 * @docsCategory core plugins/McpPlugin
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
 * @docsCategory core plugins/McpPlugin
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
}

/**
 * @description
 * The shape of an MCP tool class: an `execute` method that the server calls with the
 * {@link RequestContext}, the input, and, when a tool needs to know who is calling,
 * {@link McpCallerInfo}.
 *
 * @docsCategory core plugins/McpPlugin
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
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export const McpTool = DiscoveryService.createDecorator<McpToolMetadata>();
