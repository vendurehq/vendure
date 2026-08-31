import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    CopyableText,
    DashboardRouteDefinition,
    PermissionGuard,
    Separator,
    Skeleton,
    useAuth,
    useMutation,
    useQuery,
    z,
} from '@vendure/dashboard';
import { AlertTriangleIcon, ArrowRightIcon, ShieldCheckIcon } from 'lucide-react';

import { OAUTH_ENDPOINT_PATHS } from '../oauth/endpoint-paths';
import { isLoopbackHostname } from '../oauth/loopback';

import { TooltipButton } from './components/tooltip-button';
import { authorizeMcpClientDocument } from './mcp.graphql';

/**
 * Shape returned by the `/mcp/oauth/authorization-request` REST endpoint. Mirrors
 * `AuthorizationRequestInfo` from the OAuth service.
 */
interface AuthRequestInfo {
    client_id: string;
    client_id_source: 'cimd' | 'dcr';
    client_name: string;
    client_uri?: string;
    logo_uri?: string;
    redirect_uri: string;
    resource: string;
    toolset: string;
}

function hostnameOf(uri: string): string | null {
    try {
        return new URL(uri).hostname || null;
    } catch {
        return null;
    }
}

/**
 * The single Card shape this screen uses, whether it is loading, has failed, or is
 * showing the real request. Keeping one shell means the page doesn't jump around.
 */
function ConsentShell({
    title,
    description,
    children,
    footer,
}: {
    title: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
}) {
    return (
        <Card className="w-full max-w-lg">
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                {description ? <CardDescription className="pt-2">{description}</CardDescription> : null}
            </CardHeader>
            {children ? <CardContent className="space-y-4">{children}</CardContent> : null}
            {footer}
        </Card>
    );
}

/**
 * Badge shown next to the client's domain. Vendure fetched the client's details from that
 * domain for a CIMD client, so the hostname is something it checked itself; for any other
 * client the address is only what the client says about itself. The display name is always
 * self-chosen either way, which is why this badge sits by the domain and not by the name.
 */
function HostnameTrustBadge({ verified, metadataUrl }: { verified: boolean; metadataUrl?: string }) {
    return (
        <TooltipButton
            className="inline-flex h-auto p-0"
            tooltipClassName="max-w-sm space-y-1"
            tooltip={
                verified ? (
                    <>
                        <p>
                            <Trans>
                                The client's details were fetched from this address, so the hostname is
                                verified. The name above is still chosen by the client itself.
                            </Trans>
                        </p>
                        {metadataUrl ? <p className="font-mono break-all">{metadataUrl}</p> : null}
                    </>
                ) : (
                    <p>
                        <Trans>
                            This name and address are reported by the application itself and are not verified.
                        </Trans>
                    </p>
                )
            }
        >
            {verified ? (
                <Badge variant="success">
                    <ShieldCheckIcon className="h-3 w-3" />
                    <Trans>Hostname verified</Trans>
                </Badge>
            ) : (
                <Badge variant="warning">
                    <Trans>Unverified</Trans>
                </Badge>
            )}
        </TooltipButton>
    );
}

/**
 * What the client is asking for, and what approving it actually hands over. The toolset is
 * the OAuth scope: `admin` grants the Admin API, `shop` grants the Shop API. `account` is the
 * signed-in administrator, so the sentence can name whose access is being handed over.
 */
function scopePresentation(toolset: string, account?: { name: string; emailAddress: string }) {
    if (toolset === 'shop') {
        return {
            request: <Trans>wants to access the Shop API of your Vendure server</Trans>,
            grant: <Trans>Access to the Shop API as a customer.</Trans>,
        };
    }
    const request = <Trans>wants to access the Admin API of your Vendure server</Trans>;
    if (!account) {
        return {
            request,
            grant: <Trans>Full access to the Admin API as your administrator account.</Trans>,
        };
    }
    const { name, emailAddress } = account;
    return {
        request,
        grant: (
            <Trans>
                Full access to the Admin API as {name} ({emailAddress}).
            </Trans>
        ),
    };
}

function ConsentCard({ requestToken }: { requestToken: string }) {
    const { t } = useLingui();
    const { user } = useAuth();
    // Only used to name the account in the scope sentence; the wording falls back to the
    // generic one if the dashboard has not loaded the administrator yet.
    const signedInAccount = user
        ? { name: `${user.firstName} ${user.lastName}`.trim(), emailAddress: user.emailAddress }
        : undefined;

    const {
        data: info,
        error,
        isLoading,
    } = useQuery({
        queryKey: ['mcp-authorization-request', requestToken],
        queryFn: async (): Promise<AuthRequestInfo> => {
            const res = await fetch(
                `/${OAUTH_ENDPOINT_PATHS.authorizationRequest}?request_token=${encodeURIComponent(requestToken)}`,
                { credentials: 'include' },
            );
            if (!res.ok) {
                throw new Error(t`Request failed (${res.status})`);
            }
            return res.json() as Promise<AuthRequestInfo>;
        },
        // Don't retry: expired/used requests will always fail
        retry: false,
        // Clear previous data to avoid showing the wrong app while loading
        placeholderData: undefined,
    });

    const authorize = useMutation({
        mutationFn: (approved: boolean) => api.mutate(authorizeMcpClientDocument, { requestToken, approved }),
        onSuccess: data => {
            window.location.href = data.authorizeMcpClient.redirectUrl;
        },
    });

    if (isLoading) {
        return (
            <ConsentShell
                title={<Trans>Authorize MCP access</Trans>}
                description={<Trans>Loading authorization request…</Trans>}
            >
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-5 w-2/3" />
            </ConsentShell>
        );
    }

    if (error || !info) {
        return (
            <ConsentShell title={<Trans>Authorization request could not be loaded</Trans>}>
                <p className="text-sm">
                    <Trans>
                        The link may have expired or already been used. Start the connection again from your
                        MCP client.
                    </Trans>
                </p>
                {/* The response does not say why it failed, so the raw message sits underneath as
                    a detail rather than being presented as the reason. */}
                {error?.message ? (
                    <p className="text-xs text-muted-foreground break-all">{error.message}</p>
                ) : null}
            </ConsentShell>
        );
    }

    const redirectHost = hostnameOf(info.redirect_uri);
    const isCimdClient = info.client_id_source === 'cimd';
    // For a CIMD client the address is the client_id URL its metadata was fetched from; for
    // any other client it is whatever URI the client reported at registration.
    const clientDomain = isCimdClient
        ? (hostnameOf(info.client_id) ?? info.client_id)
        : info.client_uri
          ? (hostnameOf(info.client_uri) ?? info.client_uri)
          : null;
    const scope = scopePresentation(info.toolset, signedInAccount);
    // Amber is reserved for a destination worth a second look: a client whose hostname Vendure
    // could not check itself, a plain-http address, or one on the local machine.
    const isLoopbackRedirect = redirectHost != null && isLoopbackHostname(redirectHost);
    const redirectNeedsWarning =
        !isCimdClient || isLoopbackRedirect || !info.redirect_uri.startsWith('https://');

    return (
        <ConsentShell
            title={info.client_name?.trim() || t`Unnamed application`}
            description={
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {clientDomain ? <span className="break-all">{clientDomain}</span> : null}
                        <HostnameTrustBadge
                            verified={isCimdClient}
                            metadataUrl={isCimdClient ? info.client_id : undefined}
                        />
                    </div>
                    <div>{scope.request}</div>
                </div>
            }
            footer={
                <>
                    {authorize.error != null ? (
                        <CardContent className="w-full pt-0">
                            <Alert variant="destructive">
                                <AlertTriangleIcon className="h-4 w-4" />
                                <AlertDescription>
                                    <div>
                                        <Trans>The request could not be completed</Trans>
                                    </div>
                                    <div className="break-all">{authorize.error.message}</div>
                                </AlertDescription>
                            </Alert>
                        </CardContent>
                    ) : null}
                    <CardFooter className="justify-end gap-2">
                        <Button
                            variant="outline"
                            disabled={authorize.isPending}
                            onClick={() => authorize.mutate(false)}
                        >
                            <Trans>Deny</Trans>
                        </Button>
                        <Button disabled={authorize.isPending} onClick={() => authorize.mutate(true)}>
                            <Trans>Approve</Trans>
                        </Button>
                    </CardFooter>
                </>
            }
        >
            {/* The redirect target comes first: it is the value the server validated, and it
                decides where the authorization code actually ends up. It is only flagged in
                amber when there is something to be wary of, so the warning keeps its meaning. */}
            <div
                className={
                    redirectNeedsWarning
                        ? 'space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3'
                        : 'space-y-2 rounded-md border border-border p-3'
                }
            >
                <div className="flex items-start gap-2">
                    {redirectNeedsWarning ? (
                        <AlertTriangleIcon className="h-4 w-4 shrink-0 text-warning" />
                    ) : (
                        <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <CopyableText value={info.redirect_uri}>
                        <code className="font-mono text-xs break-all">{info.redirect_uri}</code>
                    </CopyableText>
                </div>
                <p className="text-xs text-muted-foreground">
                    <Trans>
                        After approval, the authorization code is sent here. Only approve if you recognise
                        this destination.
                    </Trans>
                </p>
                {isLoopbackRedirect ? (
                    <p className="text-xs font-medium text-warning">
                        <Trans>
                            This destination is on the local machine. Any application running on that machine
                            could receive the authorization code.
                        </Trans>
                    </p>
                ) : null}
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{info.toolset}</Badge>
                <span className="text-sm text-muted-foreground">{scope.grant}</span>
            </div>
        </ConsentShell>
    );
}

export const mcpAuthorizeRoute: DashboardRouteDefinition = {
    path: '/mcp/authorize',
    loader: () => ({ breadcrumb: () => <Trans>Authorize MCP Client</Trans> }),
    validateSearch: search => z.object({ request_token: z.string() }).parse(search),
    component: route => {
        const { request_token: requestToken } = route.useSearch();
        return (
            <PermissionGuard requires={['UpdateMcpServer']}>
                <div className="flex justify-center p-8">
                    <ConsentCard requestToken={requestToken} />
                </div>
            </PermissionGuard>
        );
    },
};
