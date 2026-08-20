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
    useMutation,
    useQuery,
    z,
} from '@vendure/dashboard';
import { AlertTriangleIcon } from 'lucide-react';

import { OAUTH_ENDPOINT_PATHS } from '../oauth/endpoint-paths';
import { isLoopbackHostname } from '../oauth/loopback';

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

/**
 * Extracts the hostname from a URI, for the two addresses the consent screen shows as the
 * things worth recognising: where the authorization code is sent, and where the client's
 * metadata document was fetched from.
 */
function hostnameOf(uri: string): string | null {
    try {
        return new URL(uri).hostname || null;
    } catch {
        return null;
    }
}

function ConsentCard({ requestToken }: { requestToken: string }) {
    const { t } = useLingui();

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
        // An expired or already-used authorization request never becomes valid, so report the
        // failure straight away rather than retrying, which is what the shared query client
        // would otherwise do three times over.
        retry: false,
        // The request token says which authorization this screen is approving, so a previous
        // request's application name and destination must never stay on screen while a
        // different one loads.
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
            <Card className="w-full max-w-lg">
                <CardContent className="py-8 text-center text-muted-foreground">
                    <Trans>Loading authorization request…</Trans>
                </CardContent>
            </Card>
        );
    }

    if (error || !info) {
        return (
            <Card className="w-full max-w-lg">
                <CardHeader>
                    <CardTitle>
                        <Trans>Authorization request could not be loaded</Trans>
                    </CardTitle>
                    <CardDescription>
                        {error?.message ?? t`The authorization session is invalid or expired.`}
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const redirectHost = hostnameOf(info.redirect_uri);
    const isCimdClient = info.client_id_source === 'cimd';
    const clientIdHost = isCimdClient ? hostnameOf(info.client_id) : null;

    return (
        <Card className="w-full max-w-lg">
            <CardHeader>
                <CardTitle>
                    <Trans>Authorize MCP access</Trans>
                </CardTitle>
                <CardDescription className="pt-2">
                    <Trans>
                        An application is requesting admin-scoped access to your Vendure MCP server. Vendure
                        cannot verify the application's identity, so decide based on the destination below —
                        not the name it reports.
                    </Trans>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/*
                 * Primary trust anchor: the redirect destination is the one field that is
                 * enforced server-side (bound into the auth request and re-checked at token
                 * exchange), so it leads the card. Everything the client reports about itself
                 * is untrusted and shown lower down.
                 */}
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                        <AlertTriangleIcon className="h-4 w-4 text-amber-600" />
                        <Trans>The authorization code will be sent to</Trans>
                    </div>
                    {redirectHost ? (
                        <div className="text-sm font-semibold break-all">{redirectHost}</div>
                    ) : null}
                    <CopyableText value={info.redirect_uri}>
                        <code className="font-mono text-xs text-muted-foreground break-all">
                            {info.redirect_uri}
                        </code>
                    </CopyableText>
                    <p className="text-xs text-muted-foreground">
                        <Trans>Approve only if you recognise and trust this exact destination.</Trans>
                    </p>
                    {/* A loopback host means "this computer": any local app could receive the code. */}
                    {redirectHost != null && isLoopbackHostname(redirectHost) ? (
                        <p className="text-xs font-medium text-amber-700">
                            <Trans>
                                This destination is on the local machine. Any application running on that
                                machine could receive the authorization code.
                            </Trans>
                        </p>
                    ) : null}
                </div>
                <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">
                        <Trans>Requested access</Trans>
                    </div>
                    <Badge variant="secondary">{info.toolset}</Badge>
                </div>
                {isCimdClient ? (
                    <div className="space-y-1 border-t pt-3">
                        <div className="text-xs font-medium text-muted-foreground">
                            <Trans>Client identity (hostname verified)</Trans>
                        </div>
                        {clientIdHost ? (
                            <div className="text-sm font-semibold break-all">{clientIdHost}</div>
                        ) : null}
                        <div className="text-xs text-muted-foreground break-all">{info.client_id}</div>
                        <p className="text-xs text-muted-foreground">
                            <Trans>
                                The client's details were fetched from this address, so the hostname is
                                verified. The name below is still chosen by the client itself.
                            </Trans>
                        </p>
                    </div>
                ) : null}
                {/* Client-supplied metadata — self-asserted and unverified, so de-emphasised. */}
                <div className="space-y-1 border-t pt-3">
                    <div className="text-xs font-medium text-muted-foreground">
                        <Trans>Reported by the application (unverified)</Trans>
                    </div>
                    <div className="text-sm">{info.client_name}</div>
                    {info.client_uri ? (
                        <div className="text-xs text-muted-foreground break-all">{info.client_uri}</div>
                    ) : null}
                </div>
            </CardContent>
            {authorize.error != null ? (
                <CardContent className="pt-0">
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
        </Card>
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
