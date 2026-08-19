import { Trans } from '@lingui/react/macro';
import { Badge, CopyableText } from '@vendure/dashboard';
import { TerminalIcon } from 'lucide-react';

/**
 * Builds the MCP client config JSON that a user pastes into their AI client
 * (Claude Desktop, Cursor, etc.) to connect to one of the Vendure MCP endpoints.
 */
function clientConfigSnippet(serverName: string, url: string): string {
    return JSON.stringify(
        {
            mcpServers: {
                [serverName]: {
                    url,
                },
            },
        },
        null,
        2,
    );
}

function EndpointCard({
    serverName,
    url,
    label,
}: {
    serverName: string;
    url: string;
    label: React.ReactNode;
}) {
    const snippet = clientConfigSnippet(serverName, url);
    return (
        <div className="rounded-md border border-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{label}</div>
                <CopyableText value={url}>
                    <code className="font-mono text-sm text-muted-foreground">{url}</code>
                </CopyableText>
            </div>
            <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                    <Trans>Client configuration</Trans>
                </div>
                <CopyableText value={snippet} className="items-start">
                    <pre className="font-mono text-xs bg-muted rounded-md p-3 overflow-x-auto w-full">
                        {snippet}
                    </pre>
                </CopyableText>
            </div>
        </div>
    );
}

/**
 * Shows the shop and admin MCP endpoint URLs with copy-to-clipboard support,
 * ready-to-paste client config snippets, and a pointer to the MCP Inspector.
 */
export function ConnectionBlock() {
    const origin = window.location.origin;
    const adminUrl = `${origin}/mcp/admin`;
    const shopUrl = `${origin}/mcp/shop`;
    const inspectorCommand = 'npx @modelcontextprotocol/inspector';

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                <Trans>Connect an MCP client to your Vendure server using the endpoints below.</Trans>
            </p>
            <EndpointCard serverName="vendure-admin" url={adminUrl} label={<Trans>Admin endpoint</Trans>} />
            <EndpointCard serverName="vendure-shop" url={shopUrl} label={<Trans>Shop endpoint</Trans>} />
            <div className="rounded-md border border-border p-4 space-y-2">
                <div className="flex items-center gap-2 font-medium">
                    <TerminalIcon className="h-4 w-4" />
                    <Trans>MCP Inspector</Trans>
                    <Badge variant="secondary">
                        <Trans>Recommended</Trans>
                    </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                    <Trans>Test and debug your MCP server interactively with the MCP Inspector:</Trans>
                </p>
                <CopyableText value={inspectorCommand}>
                    <code className="font-mono text-sm">{inspectorCommand}</code>
                </CopyableText>
            </div>
        </div>
    );
}
