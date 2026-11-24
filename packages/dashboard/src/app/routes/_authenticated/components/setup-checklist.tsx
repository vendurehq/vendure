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
                dashboardUrl
            }
        }
    }
`);

type Report = ResultOf<typeof storeReadinessDocument>['storeReadiness'];
type Finding = Report['findings'][number];

/**
 * How long a report without errors stays fresh. The check is not cheap: it prices a sample order
 * per zone. A report with errors is checked again on every visit, so a fix shows at once.
 */
const READY_REPORT_STALE_MS = 10 * 60_000;

/** The session flag set when the card is hidden while an error remains, per Channel. */
function hiddenForSessionKey(channelId: string) {
    return `vendure-setup-checklist-hidden:${channelId}`;
}

function isHiddenForSession(channelId: string | undefined): boolean {
    if (!channelId) {
        return false;
    }
    try {
        return sessionStorage.getItem(hiddenForSessionKey(channelId)) === 'true';
    } catch {
        return false;
    }
}

function hideForSession(channelId: string) {
    try {
        sessionStorage.setItem(hiddenForSessionKey(channelId), 'true');
    } catch {
        // Storage can be unavailable, for example in a private window. The card then shows again
        // the next time the home page mounts.
    }
}

export interface SetupChecklistState {
    /** Whether the home page shows the card. */
    visible: boolean;
    report: Report | undefined;
    isPending: boolean;
    /** The query failed, for example on a server without the `storeReadiness` query. */
    isError: boolean;
    dismiss: () => void;
}

/**
 * @description
 * The state of the store setup checklist for the active Channel, from the Admin API
 * `storeReadiness` query.
 *
 * The card shows on its own while the report has findings and `hasSeenOnboarding` is false.
 * Dismissing it sets `hasSeenOnboarding`, which belongs to the administrator, not to a Channel, so
 * a dismissed card with only warnings stays hidden on every Channel. While a Channel's report has
 * an error, the card shows anyway, and dismissing it hides it for that Channel until the browser
 * session ends. With `open`, as from the "Setup" item of the user menu, it always shows.
 *
 * A person without `ReadSettings`, which the query needs, gets no card. Neither does a server
 * without the `storeReadiness` query, unless the card is opened on purpose.
 */
export function useSetupChecklist(open: boolean, onClose?: () => void): SetupChecklistState {
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const { settings, settingsReady, setHasSeenOnboarding } = useUserSettings();
    const channelId = activeChannel?.id;
    const [hiddenChannels, setHiddenChannels] = useState<string[]>([]);
    const hiddenForSession = channelId
        ? hiddenChannels.includes(channelId) || isHiddenForSession(channelId)
        : false;
    const canRead = hasPermissions(['ReadSettings']);

    const { data, isError, isPending } = useQuery({
        queryKey: ['storeReadiness', channelId],
        queryFn: () => api.query(storeReadinessDocument, { channelIds: [channelId!] }),
        // Hidden for the session, the card cannot show until the session ends, so there is no need
        // to run the check.
        enabled: canRead && !!channelId && (open || !hiddenForSession),
        // A server without the query answers with a validation error. Retrying does not help.
        retry: false,
        staleTime: query => (query.state.data?.storeReadiness.ready === false ? 0 : READY_REPORT_STALE_MS),
        // Never show the report of the Channel that was active before.
        placeholderData: undefined,
    });

    const report = data?.storeReadiness;
    const hasFindings = !!report && report.findings.length > 0;
    // Until the stored settings load, `hasSeenOnboarding` is the local copy or the default.
    const shownByItself =
        !!report &&
        hasFindings &&
        !hiddenForSession &&
        (!report.ready || (settingsReady && !settings.hasSeenOnboarding));
    const visible = canRead && !!channelId && (open || shownByItself);

    const dismiss = () => {
        // Set before the stored settings load, the flag would be replaced by the stored value.
        if (settingsReady) {
            setHasSeenOnboarding(true);
        }
        if (channelId && report && !report.ready) {
            hideForSession(channelId);
            setHiddenChannels(channels => [...channels, channelId]);
        }
        onClose?.();
    };

    return { visible, report, isPending, isError, dismiss };
}

/**
 * @description
 * Lists what stops the active Channel from taking an order, with a link to the page that fixes each
 * finding. The fixes of a finding are MCP admin tool calls, written for an agent, so the card
 * leaves them out. The home page renders it when {@link useSetupChecklist} says that it is visible.
 */
export function SetupChecklist({ state }: Readonly<{ state: SetupChecklistState }>) {
    const { report, isPending, isError, dismiss } = state;
    const findings = report?.findings ?? [];
    const hasErrors = report?.ready === false;

    return (
        <Card data-testid="setup-checklist">
            <CardHeader>
                <CardTitle>
                    <Trans>Store setup</Trans>
                </CardTitle>
                <CardDescription>
                    {isError ? (
                        <Trans>This server cannot check the store setup.</Trans>
                    ) : isPending || !report ? (
                        <Trans>Checking the store setup…</Trans>
                    ) : hasErrors ? (
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
                        {hasErrors ? <Trans>Hide for now</Trans> : <Trans>Dismiss</Trans>}
                    </Button>
                </CardAction>
            </CardHeader>
            {report ? (
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
                {finding.dashboardUrl ? (
                    <Link to={finding.dashboardUrl} className="text-primary w-fit hover:underline">
                        <Trans>Open</Trans>
                    </Link>
                ) : null}
            </div>
        </li>
    );
}
