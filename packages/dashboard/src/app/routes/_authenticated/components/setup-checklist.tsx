import { Button } from '@/vdb/components/ui/button.js';
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/vdb/components/ui/card.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

export const storeReadinessDocument = graphql(`
    query StoreReadinessForSetupChecklist($channelIds: [ID!]) {
        storeReadiness(channelIds: $channelIds) {
            ready
            findings {
                code
                severity
                message
                fixes {
                    description
                }
                dashboardUrl
            }
        }
    }
`);

type Finding = ResultOf<typeof storeReadinessDocument>['storeReadiness']['findings'][number];

/** Set for the browser session when the card is hidden while an error remains. */
const HIDDEN_FOR_SESSION_KEY = 'vendure-setup-checklist-hidden';

function isHiddenForSession(): boolean {
    try {
        return sessionStorage.getItem(HIDDEN_FOR_SESSION_KEY) === 'true';
    } catch {
        return false;
    }
}

function hideForSession() {
    try {
        sessionStorage.setItem(HIDDEN_FOR_SESSION_KEY, 'true');
    } catch {
        // Storage can be unavailable, for example in a private window. The card then shows again
        // on the next render that remounts it.
    }
}

export interface SetupChecklistProps {
    /** Show the card even when it was dismissed or has nothing to report, as the "Setup" menu item does. */
    open?: boolean;
    /** Called when the person closes a card that `open` showed. */
    onClose?: () => void;
}

/**
 * @description
 * Lists what stops the active Channel from taking an order, from the Admin API `storeReadiness`
 * query, with a link to the page that fixes each finding.
 *
 * It shows on its own until the person dismisses it. "Dismiss" sets `hasSeenOnboarding`, which
 * hides a card with only warnings for good. While an error remains, the card shows again on the
 * next visit, so a store that cannot take orders does not go unnoticed. A server without the
 * `storeReadiness` query, or a person without `ReadSettings`, gets no card.
 */
export function SetupChecklist({ open = false, onClose }: Readonly<SetupChecklistProps>) {
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const { settings, setHasSeenOnboarding } = useUserSettings();
    const [hiddenForSession, setHiddenForSession] = useState(isHiddenForSession);
    const canRead = hasPermissions(['ReadSettings']);

    const { data, isError, isPending } = useQuery({
        queryKey: ['storeReadiness', activeChannel?.id],
        queryFn: () => api.query(storeReadinessDocument, { channelIds: [activeChannel!.id] }),
        enabled: canRead && !!activeChannel,
        // A server without the query answers with a validation error. Retrying does not help.
        retry: false,
        staleTime: 60_000,
    });

    if (!canRead || (isPending && !open)) {
        return null;
    }
    const findings = data?.storeReadiness.findings ?? [];
    const errors = findings.filter(finding => finding.severity === 'ERROR');
    const shownByItself =
        !isError &&
        findings.length > 0 &&
        !hiddenForSession &&
        (!settings.hasSeenOnboarding || errors.length > 0);
    if (!open && !shownByItself) {
        return null;
    }

    const dismiss = () => {
        setHasSeenOnboarding(true);
        if (errors.length > 0) {
            hideForSession();
            setHiddenForSession(true);
        }
        onClose?.();
    };

    return (
        <Card data-testid="setup-checklist">
            <CardHeader>
                <CardTitle>
                    <Trans>Store setup</Trans>
                </CardTitle>
                <CardDescription>
                    {isError ? (
                        <Trans>This server cannot check the store setup.</Trans>
                    ) : isPending ? (
                        <Trans>Checking the store setup…</Trans>
                    ) : errors.length > 0 ? (
                        <Trans>Fix these before this channel can take orders.</Trans>
                    ) : findings.length > 0 ? (
                        <Trans>This channel can take orders. These items are worth a look.</Trans>
                    ) : (
                        <Trans>This channel is ready to take orders.</Trans>
                    )}
                </CardDescription>
                <CardAction>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={dismiss}
                        data-testid="setup-checklist-dismiss"
                    >
                        {errors.length > 0 ? <Trans>Hide for now</Trans> : <Trans>Dismiss</Trans>}
                    </Button>
                </CardAction>
            </CardHeader>
            {findings.length > 0 || (!isError && !isPending) ? (
                <CardContent>
                    {findings.length > 0 ? (
                        <ul className="flex flex-col gap-3">
                            {findings.map((finding, index) => (
                                <SetupChecklistItem key={`${finding.code}-${index}`} finding={finding} />
                            ))}
                        </ul>
                    ) : (
                        <div className="text-success flex items-center gap-2 text-sm">
                            <CircleCheck className="h-4 w-4" />
                            <Trans>No setup gaps found.</Trans>
                        </div>
                    )}
                </CardContent>
            ) : null}
        </Card>
    );
}

function SetupChecklistItem({ finding }: Readonly<{ finding: Finding }>) {
    const isError = finding.severity === 'ERROR';
    const Icon = isError ? CircleAlert : TriangleAlert;
    return (
        <li className="flex items-start gap-3" data-testid="setup-checklist-item" data-code={finding.code}>
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isError ? 'text-destructive' : 'text-warning'}`} />
            <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span>{finding.message}</span>
                {finding.fixes.map((fix, index) => (
                    <span key={index} className="text-muted-foreground">
                        {fix.description}
                    </span>
                ))}
                {finding.dashboardUrl ? (
                    <Link to={finding.dashboardUrl} className="text-primary w-fit hover:underline">
                        <Trans>Open</Trans>
                    </Link>
                ) : null}
            </div>
        </li>
    );
}
