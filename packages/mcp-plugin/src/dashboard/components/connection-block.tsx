import { Trans } from '@lingui/react/macro';
import {
    api,
    Button,
    CopyableText,
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    Separator,
    useQuery,
} from '@vendure/dashboard';
import { ExternalLinkIcon, PlugIcon } from 'lucide-react';

import { mcpServerConfigQuery } from '../mcp.graphql';

/** Docs page that walks through connecting an MCP client to a Vendure server. */
const SETUP_GUIDE_URL = 'https://docs.vendure.io/guides/mcp-server/quick-start/';

/**
 * A muted label above a read-only value, shown in a monospace box with the copy button at the
 * right edge of the box. Long values are truncated, and the whole value is still copied and is
 * readable from the tooltip.
 */
function CopyableField({ label, value }: { label: React.ReactNode; value: string }) {
    return (
        <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <CopyableText value={value} className="justify-between rounded-md border bg-muted/50 px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs select-all" title={value}>
                    {value}
                </code>
            </CopyableText>
        </div>
    );
}

/**
 * The endpoints and setup pointers an operator needs once, when wiring up a client. It lives
 * behind a header button rather than on the page so it does not compete with the day-to-day
 * health and activity blocks.
 */
export function ConnectionDialog() {
    const { data, isLoading } = useQuery({
        queryKey: ['mcp-server-config'],
        queryFn: () => api.query(mcpServerConfigQuery),
    });
    const config = data?.mcpServerConfig;
    // Clients have to reach the server on its OAuth issuer origin, which is not always the
    // origin the dashboard itself is served from.
    const origin = config?.issuer ?? window.location.origin;
    const adminUrl = `${origin}/mcp/admin`;
    const shopUrl = `${origin}/mcp/shop`;
    const inspectorCommand = 'npx @modelcontextprotocol/inspector';
    // Until the config arrives both endpoints are shown, so the dialog does not flash empty.
    const showAdminUrl = isLoading || config?.oauthConfigured !== false;
    const showShopUrl = isLoading || config?.shopAccess !== 'disabled';

    return (
        <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
                <PlugIcon className="h-4 w-4" />
                <Trans>Connect a client</Trans>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Connect a client</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Connect an MCP client to your Vendure server using the endpoints below.</Trans>
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {showAdminUrl ? (
                        <CopyableField label={<Trans>Admin API</Trans>} value={adminUrl} />
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            <Trans>
                                The admin endpoint needs OAuth. Add an oauth block to McpPlugin.init to enable
                                it.
                            </Trans>
                        </p>
                    )}
                    {showShopUrl ? (
                        <CopyableField label={<Trans>Shop API</Trans>} value={shopUrl} />
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            <Trans>The shop endpoint is disabled (shopAccess: 'disabled').</Trans>
                        </p>
                    )}
                    <Separator />
                    <CopyableField label={<Trans>Test with MCP Inspector</Trans>} value={inspectorCommand} />
                </div>

                <DialogFooter className="sm:items-center sm:justify-between">
                    <Button
                        variant="link"
                        className="px-0"
                        render={<a href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer noopener" />}
                    >
                        <ExternalLinkIcon className="h-3.5 w-3.5" />
                        <Trans>Setup guide for connecting MCP clients</Trans>
                    </Button>
                    <DialogClose render={<Button variant="outline" />}>
                        <Trans>Close</Trans>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
