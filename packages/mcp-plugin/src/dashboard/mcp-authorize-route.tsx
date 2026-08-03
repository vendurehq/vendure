import { Trans, useLingui } from '@lingui/react/macro';
import {
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
    z,
} from '@vendure/dashboard';
import { AlertTriangleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Shape returned by the `/mcp/oauth/authorization-request` REST endpoint. Mirrors
 * `AuthorizationRequestInfo` from the OAuth service.
 */
interface AuthRequestInfo {
    client_id: string;
    client_name: string;
    client_uri?: string;
    logo_uri?: string;
    redirect_uri: string;
    resource: string;
    toolset: string;
}

/**
 * Extracts the hostname from a redirect URI so it can be shown as the primary
 * trust anchor on the consent screen.
 */
function redirectHostname(uri: string): string | null {
    try {
        return new URL(uri).hostname || null;
    } catch {
        return null;
    }
}

function ConsentCard({ requestToken }: { requestToken: string }) {
    const { t } = useLingui();
    const [info, setInfo] = useState<AuthRequestInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(`/mcp/oauth/authorization-request?request_token=${encodeURIComponent(requestToken)}`, {
            credentials: 'include',
        })
            .then(async res => {
                if (!res.ok) {
                    throw new Error(t`Request failed (${res.status})`);
                }
                return res.json();
            })
            .then((data: AuthRequestInfo) => {
                if (!cancelled) {
                    setInfo(data);
                    setLoading(false);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [requestToken]);

    const submit = async (approved: boolean) => {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/mcp/oauth/admin-consent', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ request_token: requestToken, approved }),
            });
            if (!res.ok) {
                throw new Error(`Request failed (${res.status})`);
            }
            const data: { redirectUrl: string } = await res.json();
            window.location.href = data.redirectUrl;
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
            setSubmitting(false);
        }
    };

    if (loading) {
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
                        {error ?? t`The authorization session is invalid or expired.`}
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const redirectHost = redirectHostname(info.redirect_uri);

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
                </div>
                <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">
                        <Trans>Requested access</Trans>
                    </div>
                    <Badge variant="secondary">{info.toolset}</Badge>
                </div>
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
            <CardFooter className="justify-end gap-2">
                <Button variant="outline" disabled={submitting} onClick={() => void submit(false)}>
                    <Trans>Deny</Trans>
                </Button>
                <Button disabled={submitting} onClick={() => void submit(true)}>
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
