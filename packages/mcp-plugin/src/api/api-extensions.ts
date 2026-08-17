import { gql } from 'graphql-tag';

/**
 * Admin API for the MCP server: list tools and OAuth grants, page through the
 * tool-call log, read usage stats, record an admin's consent decision, and run
 * the maintenance mutations (toggle a tool, revoke a grant, delete old logs).
 */
export const adminApiExtensions = gql`
    "A registered tool and whether it is currently enabled."
    type McpToolInfo {
        id: ID!
        name: String!
        toolset: String!
        description: String!
        pluginSource: String!
        behavior: String!
        enabled: Boolean!
    }

    "An OAuth grant, summarised for the admin overview. Revoked and expired grants are included only when requested."
    type McpOauthGrant implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        actorId: String
        actorType: String
        channelId: ID
        oauthClientName: String
        lastActivityAt: DateTime!
        expiresAt: DateTime!
        revokedAt: DateTime
    }

    type McpOauthGrantList implements PaginatedList {
        items: [McpOauthGrant!]!
        totalItems: Int!
    }

    """
    One logged tool call. input and output are null unless the server is set to
    capture full call bodies and the caller also holds the ReadCustomer permission.
    """
    type McpToolCallLog implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        grantId: ID
        "The id of the Vendure user the call ran as. Null when nobody was signed in."
        actor: String
        actorType: String!
        "Stored only when logging.captureClientIp is enabled. Requires the ReadCustomer permission to read."
        clientIp: String
        channelId: ID
        toolName: String!
        pluginSource: String
        input: JSON
        output: JSON
        durationMs: Int
        status: String!
        oauthClientId: ID
    }

    type McpToolCallLogList implements PaginatedList {
        items: [McpToolCallLog!]!
        totalItems: Int!
    }

    type McpTopTool {
        toolName: String!
        count: Int!
    }

    type McpStats {
        totalCalls: Int!
        successRate: Float!
        errorRate: Float!
        p50LatencyMs: Int
        p95LatencyMs: Int
        callsPerHour: Float!
        topTools: [McpTopTool!]!
    }

    extend type Query {
        "Every registered tool with its enabled state."
        mcpTools: [McpToolInfo!]!
        "OAuth grants, newest activity first. Lists active grants by default; pass includeInactive: true to also include revoked and expired ones."
        mcpOauthGrants(
            includeInactive: Boolean! = false
            options: McpOauthGrantListOptions
        ): McpOauthGrantList!
        "The tool-call log, paginated and filterable."
        mcpToolCallLogs(options: McpToolCallLogListOptions): McpToolCallLogList!
        "Usage stats for a time window. timeRange is one of 1h, 24h, 7d, 30d (default 24h); other values are rejected."
        mcpStats(timeRange: String): McpStats!
    }

    "Where to send the browser once an administrator has approved or denied an MCP client."
    type McpAuthorizationResult {
        redirectUrl: String!
    }

    extend type Mutation {
        "Enable or disable a tool. Returns the tool with its new state."
        setMcpToolEnabled(toolName: String!, toolset: String!, enabled: Boolean!): McpToolInfo!
        "Revoke an OAuth grant. Returns false if no grant has that id."
        revokeMcpOauthGrant(id: ID!): Boolean!
        "Delete tool-call logs past the retention window. Returns how many were deleted."
        removeExpiredMcpToolCallLogs: Int!
        """
        Records the signed-in administrator's decision on a pending MCP authorization request.
        Both approval and denial require the UpdateMcpServer permission.
        """
        authorizeMcpClient(requestToken: String!, approved: Boolean!): McpAuthorizationResult!
    }

    # Auto-generated at runtime
    input McpToolCallLogListOptions

    # Auto-generated at runtime
    input McpOauthGrantListOptions
`;

/**
 * Shop API for the MCP server: the single mutation a storefront consent page calls to
 * record a customer's decision. The customer and the channel come from the ordinary
 * request context, so the page never handles a session token itself.
 *
 * Reading the pending request needs no session and is served by the unauthenticated
 * `GET /mcp/oauth/authorization-request` endpoint, which the dashboard consent page uses too.
 */
export const shopApiExtensions = gql`
    "Where to send the browser once a customer has approved or denied an MCP client."
    type McpAuthorizationResult {
        redirectUrl: String!
    }

    "One of the signed-in customer's own active MCP OAuth grants, summarised for a connected-assistants page."
    type McpCustomerOauthGrantInfo {
        id: ID!
        createdAt: DateTime!
        oauthClientName: String
        lastActivityAt: DateTime!
        expiresAt: DateTime!
    }

    extend type Query {
        "The signed-in customer's own active (not revoked, not expired) MCP OAuth grants, across every channel."
        activeMcpClientGrants: [McpCustomerOauthGrantInfo!]!
    }

    extend type Mutation {
        """
        Records the signed-in customer's decision on a pending MCP authorization request.
        Denial does not require a signed-in customer; approval does.
        """
        authorizeMcpClient(requestToken: String!, approved: Boolean!): McpAuthorizationResult!
        """
        Revokes one of the signed-in customer's own MCP OAuth grants. Throws if no such grant
        exists for the signed-in customer.
        """
        revokeMcpClientGrant(id: ID!): Boolean!
    }
`;
