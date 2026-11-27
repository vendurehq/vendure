import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/vdb/components/ui/card.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ActionNeeded, type ActionNeededItem } from '@vendure-io/ui/components/molecules/action-needed';
import { CircleCheck } from 'lucide-react';

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

export interface SetupChecklistState {
    /** Whether the home page shows the card. */
    visible: boolean;
    report: Report | undefined;
    isPending: boolean;
    /** The query failed, for example on a server without the `storeReadiness` query. */
    isError: boolean;
    /** The active Channel. Its id names the fold memory of the card. */
    channelId: string | undefined;
    channelCode: string | undefined;
}

/**
 * @description
 * The state of the store setup checklist for the active Channel, from the Admin API
 * `storeReadiness` query.
 *
 * The card shows on its own while the report has findings. Folding its list is the only way to
 * put it away: the fold is remembered per Channel, and a new finding opens the list again. With
 * `open`, as from the "Setup" item of the user menu, the card also shows without findings.
 *
 * A person without `ReadSettings`, which the query needs, gets no card. Neither does a server
 * without the `storeReadiness` query, unless the card is opened on purpose.
 */
export function useSetupChecklist(open: boolean): SetupChecklistState {
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const channelId = activeChannel?.id;
    const canRead = hasPermissions(['ReadSettings']);

    const { data, isError, isPending } = useQuery({
        queryKey: ['storeReadiness', channelId],
        queryFn: () => api.query(storeReadinessDocument, { channelIds: [channelId!] }),
        enabled: canRead && !!channelId,
        // A server without the query answers with a validation error. Retrying does not help.
        retry: false,
        staleTime: query => (query.state.data?.storeReadiness.ready === false ? 0 : READY_REPORT_STALE_MS),
        // Never show the report of the Channel that was active before.
        placeholderData: undefined,
    });

    const report = data?.storeReadiness;
    const hasFindings = !!report && report.findings.length > 0;
    const visible = canRead && !!channelId && (open || hasFindings);

    return { visible, report, isPending, isError, channelId, channelCode: activeChannel?.code };
}

interface FindingCopy {
    /** A short label for the finding. The server's sentence goes under it. */
    title: MessageDescriptor;
    /** What the button to the finding's page does. */
    action: MessageDescriptor;
}

const FINDING_COPY: Record<string, FindingCopy> = {
    'store.auth.default-superadmin-password': {
        title: msg`Default superadmin password`,
        action: msg`Change password`,
    },
    'store.search.index-incomplete': { title: msg`Search index out of date`, action: msg`Rebuild index` },
    'store.channel.no-shipping-method': { title: msg`No shipping method`, action: msg`Set up shipping` },
    'store.shipping.no-eligible-method': { title: msg`No shipping for a zone`, action: msg`Set up shipping` },
    'store.channel.no-payment-method': { title: msg`No payment method`, action: msg`Set up payments` },
    'store.channel.no-sellable-variant': { title: msg`Nothing to sell`, action: msg`Add products` },
    'store.channel.missing-prices': { title: msg`Missing prices`, action: msg`Add prices` },
    'store.channel.no-stock-location': { title: msg`No stock location`, action: msg`Add stock location` },
    'store.channel.no-default-tax-zone': { title: msg`No default tax zone`, action: msg`Set tax zone` },
    'store.channel.no-default-shipping-zone': {
        title: msg`No default shipping zone`,
        action: msg`Set shipping zone`,
    },
    'store.channel.tax-country-unknown': { title: msg`Unknown tax country`, action: msg`Edit channel` },
    'store.channel.tax-country-outside-default-zone': {
        title: msg`Tax country outside the default zone`,
        action: msg`Edit channel`,
    },
    'store.tax.no-rate': { title: msg`Missing tax rate`, action: msg`Add tax rate` },
    'store.tax.inclusive-rate-unknown': { title: msg`Unknown tax-inclusive rate`, action: msg`Add tax rate` },
    'store.tax.ambiguous-zone-rates': { title: msg`Overlapping tax rates`, action: msg`Review tax rates` },
    'store.zone.no-enabled-country': { title: msg`Zone without countries`, action: msg`Edit zone` },
    'store.check.failed': { title: msg`A check could not run`, action: msg`View details` },
};

/** A finding from a check that this Dashboard does not know, such as one a plugin adds. */
const FALLBACK_COPY: FindingCopy = { title: msg`Store setup issue`, action: msg`Fix it` };

/**
 * @description
 * The server names a Channel by its code. The default Channel's code is an internal name, so the
 * card calls it "the default channel".
 */
export function readableFindingMessage(message: string, channelCode: string | undefined): string {
    if (channelCode !== DEFAULT_CHANNEL_CODE) {
        return message;
    }
    const quoted = `"${DEFAULT_CHANNEL_CODE}"`;
    return message
        .replaceAll(`Channel ${quoted}`, 'The default channel')
        .replaceAll(`channel ${quoted}`, 'the default channel')
        .replaceAll(quoted, 'the default channel');
}

/**
 * The keys that name each finding for the fold memory. Counts in the message ("77 of 88") are left
 * out, so a count that changes does not open a folded list again; another zone or tax category
 * does. Two findings that read the same without their counts get a number.
 */
function findingKeys(findings: readonly Finding[]): string[] {
    const seen = new Map<string, number>();
    return findings.map(finding => {
        const base = `${finding.code}:${finding.message.replace(/\d+/g, '#')}`;
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return count === 0 ? base : `${base}#${count}`;
    });
}

/**
 * @description
 * Lists what needs the administrator on the active Channel, with a button to the page that fixes
 * each finding. The fixes of a finding are MCP admin tool calls, written for an agent, so the card
 * leaves them out. The home page renders it when {@link useSetupChecklist} says that it is visible.
 */
export function SetupChecklist({ state }: Readonly<{ state: SetupChecklistState }>) {
    const { report, isPending, isError, channelId, channelCode } = state;
    const { i18n } = useLingui();
    const findings = report?.findings ?? [];
    const hasErrors = report?.ready === false;
    const keys = findingKeys(findings);

    const items = findings.map((finding, index): ActionNeededItem => {
        const copy = FINDING_COPY[finding.code] ?? FALLBACK_COPY;
        return {
            key: keys[index],
            tone: finding.severity === 'ERROR' ? 'critical' : 'warning',
            title: i18n._(copy.title),
            description: readableFindingMessage(finding.message, channelCode),
            action: finding.dashboardUrl ? (
                <Button variant="outline" size="sm" render={<Link to={finding.dashboardUrl} />}>
                    {i18n._(copy.action)}
                </Button>
            ) : undefined,
        };
    });

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
            </CardHeader>
            {report ? (
                <CardContent>
                    {items.length > 0 ? (
                        <ActionNeeded
                            items={items}
                            memoryKey={channelId ? `dashboard:setup-checklist:${channelId}` : undefined}
                            label={i18n._(msg`Action needed`)}
                            toneLabels={{
                                critical: i18n._(msg`Error`),
                                warning: i18n._(msg`Warning`),
                                info: i18n._(msg`Info`),
                            }}
                        />
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
