import { DiscoveryService } from '@nestjs/core';
import type { Permission } from '@vendure/common/lib/generated-types';
import type { ID, RequestContext } from '@vendure/core';

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
    [key: string]: unknown;
}

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
    /** Unique snake_case name within the toolset, e.g. "search_products". */
    name: string;
    /** Optional title. */
    title?: string;
    /** What the tool does, written for an AI agent to read. */
    description: string;
    /**
     * Optional search keywords: synonyms and phrasings a user would actually say, e.g.
     * `['money back', 'reimburse']` for a refund tool. Used only to match `search_tools`
     * queries in discovery mode; never shown to the agent or returned in responses.
     */
    keywords?: string[];
    /** Which API the tool uses (shop or admin). */
    toolset: McpToolset;
    /**
     * Permissions needed to call the tool. The caller only needs one of them
     * (OR logic, the same as `@Allow`).
     *
     * On a `shop` tool, omitting this (or declaring an empty array) means Public — callable by
     * anyone who can reach the shop endpoint, no authentication required.
     *
     * On an `admin` tool, this is required: the server refuses to start if it is omitted or
     * empty. If any administrator may call it, you can use `[Permission.Authenticated]`.
     */
    permissions?: Permission[];
    /**
     * How the tool behaves; controls how it is exposed to the agent. One of:
     * - `'readonly'` — changes nothing.
     * - `'mutating'` — writes data and runs immediately (the default when omitted).
     * - `'destructive'` — writes data and requires the confirmation round-trip before running.
     */
    behavior?: McpToolBehavior;
    /** Optional JSON Schema used to validate the tool's input. */
    inputSchema?: McpJsonSchema;
    /** Optional JSON Schema describing the tool's output. */
    outputSchema?: McpJsonSchema;
}

/**
 * @description
 * The MCP OAuth grant behind a tool call, when the call arrived over MCP OAuth.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpCallerGrant {
    /** ID of the MCP OAuth grant this call was authenticated with. */
    id: ID;
    /** ID of the OAuth client (the connecting app) the grant was issued to. */
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
    /** Present when the call arrived via MCP OAuth. Absent for anonymous shop calls and in-process calls. */
    grant?: McpCallerGrant;
    /** Client IP resolved by the HTTP transport. Absent for in-process calls. */
    clientIp?: string;
}

/**
 * @description
 * The shape of an MCP tool class: an `execute` method that the server calls with the
 * {@link RequestContext}, the input, and — when a tool needs to know who is calling —
 * {@link McpCallerInfo}.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpToolHandler<I = unknown, O = unknown> {
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
