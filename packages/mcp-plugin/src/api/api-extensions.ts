import { gql } from 'graphql-tag';

/**
 * Admin API for the MCP server: list tools and OAuth grants, page through the
 * tool-call log, read usage stats, record an admin's consent decision, and run
 * the maintenance mutations (toggle a tool, revoke a grant, delete old logs).
 */
export const adminApiExtensions = gql`
    "Which endpoint a tool is served from."
    enum McpToolset {
        shop
        admin
    }

    "What a tool does to data: readonly tools only read it, mutating tools change it, and destructive tools ask for confirmation first."
    enum McpToolBehavior {
        readonly
        mutating
        destructive
    }

    "Whether an administrator or a customer approved an OAuth grant."
    enum McpGrantUserType {
        customer
        admin
    }

    "Who a tool call ran as. anonymous means nobody was signed in."
    enum McpActorType {
        customer
        admin
        anonymous
    }

    "The three states an OAuth grant can be in."
    enum McpOauthGrantStatus {
        active
        expired
        revoked
    }

    "Whether a logged tool call succeeded or failed."
    enum McpToolCallStatus {
        success
        error
    }

    "A registered tool and whether it is currently enabled."
    type McpToolInfo {
        id: ID!
        name: String!
        toolset: McpToolset!
        description: String!
        pluginSource: String!
        behavior: McpToolBehavior!
        enabled: Boolean!
    }

    "An OAuth grant, summarised for the admin overview. Revoked and expired grants are included only when requested."
    type McpOauthGrant implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        actorId: String
        actorType: McpGrantUserType
        "The name of the person who approved the grant. Null when the account no longer exists."
        actorName: String
        "The Customer id when the grant was approved by a customer, so the dashboard can link to them. Null otherwise."
        customerId: ID
        channelId: ID
        oauthClientName: String
        lastActivityAt: DateTime!
        expiresAt: DateTime!
        revokedAt: DateTime
        "Worked out from revokedAt and expiresAt rather than stored, so it is always current."
        status: McpOauthGrantStatus!
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
        actorType: McpActorType!
        "The name of the person the call ran as. Null when nobody was signed in or the account no longer exists."
        actorName: String
        "The Customer id when the call ran as a customer, so the dashboard can link to them. Null otherwise."
        customerId: ID
        "Stored only when logging.captureClientIp is enabled. Requires the ReadCustomer permission to read."
        clientIp: String
        channelId: ID
        toolName: String!
        pluginSource: String
        input: JSON
        output: JSON
        durationMs: Int
        status: McpToolCallStatus!
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
        setMcpToolEnabled(toolName: String!, toolset: McpToolset!, enabled: Boolean!): McpToolInfo!
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

    # Vendure builds the sort and filter inputs from these types at run time, but it only offers
    # scalar fields for sorting. Declaring the enum-typed columns here keeps them sortable; the
    # generator merges these fields into the input it builds.
    input McpToolCallLogSortParameter {
        actorType: SortOrder
        status: SortOrder
    }

    input McpOauthGrantSortParameter {
        actorType: SortOrder
        status: SortOrder
    }
`;

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
