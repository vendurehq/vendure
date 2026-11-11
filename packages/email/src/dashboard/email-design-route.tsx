import { Trans, useLingui } from '@lingui/react/macro';
import {
    ActionBarItem,
    api,
    Button,
    ButtonGroup,
    DashboardRouteDefinition,
    Label,
    NativeSelect,
    NativeSelectOption,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    PermissionGuard,
    toast,
    useChannel,
    useMutation,
    usePermissions,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { MonitorIcon, SmartphoneIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { EmailDesignForm } from './components/email-design-form';
import { SendTestEmailButton } from './components/send-test-email-dialog';
import {
    EmailContentScope,
    EmailDesignData,
    emailDesignQuery,
    EmailDesignValue,
    EmailDesignValues,
    emailOverviewQuery,
    EmailOverviewResult,
    EmailPreviewResult,
    previewEmailQuery,
    updateEmailDesignMutation,
} from './email.graphql';

const WIDTHS = { desktop: 600, mobile: 375 } as const;

function EmailDesignPage() {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const canEdit = hasPermissions(['UpdateSettings']);
    const [scope, setScope] = useState<EmailContentScope>('ALL_CHANNELS');
    const [values, setValues] = useState<EmailDesignValues>({});
    const [previewType, setPreviewType] = useState<string | undefined>();
    const [width, setWidth] = useState<keyof typeof WIDTHS>('desktop');

    const designQuery = useQuery<{ emailDesign: EmailDesignData }>({
        queryKey: ['emailDesign', scope],
        queryFn: () => api.query(emailDesignQuery, { scope }),
    });
    const data = designQuery.data?.emailDesign;
    useEffect(() => setValues(data?.design ?? {}), [data]);

    const overview = useQuery<EmailOverviewResult>({
        queryKey: ['emailOverview'],
        queryFn: () => api.query(emailOverviewQuery),
    });
    const emails = overview.data?.emailOverview.emails ?? [];
    const selected = emails.find(e => e.type === previewType) ?? emails[0];

    const changes = useMemo(() => diff(data?.design ?? {}, values), [data, values]);
    const draft = useDebounced(previewableDesign(values, data), 300);

    const preview = useQuery<EmailPreviewResult>({
        queryKey: ['previewEmail', 'design', selected?.type, activeChannel?.code, draft],
        queryFn: () =>
            api.query(previewEmailQuery, {
                input: { type: selected?.type, channelCode: activeChannel?.code, design: draft },
            }),
        enabled: !!selected,
        retry: false,
        placeholderData: previous => previous,
    });

    const save = useMutation({
        mutationFn: () => api.mutate(updateEmailDesignMutation, { input: { scope, design: changes } }),
        onSuccess: (result: any) => {
            queryClient.setQueryData(['emailDesign', scope], { emailDesign: result.updateEmailDesign });
            toast.success(t`Email design saved`);
        },
        onError: (err: any) => toast.error(err?.message ?? t`Could not save the email design`),
    });
    const dirty = Object.keys(changes).length > 0;

    return (
        <Page pageId="email-design">
            <PageTitle>
                <Trans>Email design</Trans>
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="discard-button" requiresPermission={['UpdateSettings']}>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!dirty || save.isPending}
                        onClick={() => setValues(data?.design ?? {})}
                    >
                        <Trans>Discard</Trans>
                    </Button>
                </ActionBarItem>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateSettings']}>
                    <Button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                        {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PermissionGuard requires={['ReadSettings']}>
                <PageLayout>
                    <PageBlock
                        column="side"
                        blockId="email-design-form"
                        title={<Trans>Design</Trans>}
                        description={<Trans>Applies to every email. Empty fields use the default.</Trans>}
                    >
                        <div className="flex flex-col gap-6">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="email-design-scope">
                                    <Trans>Applies to</Trans>
                                </Label>
                                <NativeSelect
                                    id="email-design-scope"
                                    value={scope}
                                    onChange={e => setScope(e.target.value as EmailContentScope)}
                                >
                                    <NativeSelectOption value="ALL_CHANNELS">{t`All channels`}</NativeSelectOption>
                                    <NativeSelectOption value="CHANNEL">
                                        {t`This channel only (${activeChannel?.code ?? ''})`}
                                    </NativeSelectOption>
                                </NativeSelect>
                            </div>
                            {data ? (
                                <EmailDesignForm
                                    data={data}
                                    values={values}
                                    disabled={!canEdit}
                                    onChange={(name, value) => setValues(v => ({ ...v, [name]: value }))}
                                />
                            ) : null}
                        </div>
                    </PageBlock>
                    <PageBlock
                        column="main"
                        blockId="email-design-preview"
                        title={<Trans>Preview</Trans>}
                        description={
                            <Trans>Shows unsaved changes. Pick an email to see the design on it.</Trans>
                        }
                    >
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="email-design-preview-type">
                                        <Trans>Email</Trans>
                                    </Label>
                                    <NativeSelect
                                        id="email-design-preview-type"
                                        value={selected?.type ?? ''}
                                        onChange={e => setPreviewType(e.target.value)}
                                    >
                                        {emails.map(email => (
                                            <NativeSelectOption key={email.type} value={email.type}>
                                                {email.label}
                                            </NativeSelectOption>
                                        ))}
                                    </NativeSelect>
                                </div>
                                <ButtonGroup className="ml-auto">
                                    <Button
                                        type="button"
                                        variant={width === 'desktop' ? 'default' : 'outline'}
                                        aria-pressed={width === 'desktop'}
                                        onClick={() => setWidth('desktop')}
                                    >
                                        <MonitorIcon />
                                        <Trans>Desktop</Trans>
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={width === 'mobile' ? 'default' : 'outline'}
                                        aria-pressed={width === 'mobile'}
                                        onClick={() => setWidth('mobile')}
                                    >
                                        <SmartphoneIcon />
                                        <Trans>Mobile</Trans>
                                    </Button>
                                </ButtonGroup>
                                {selected ? (
                                    <SendTestEmailButton
                                        disabled={!canEdit}
                                        input={{
                                            type: selected.type,
                                            label: selected.label,
                                            channelCode: activeChannel?.code,
                                            design: draft,
                                        }}
                                    />
                                ) : null}
                            </div>
                            {preview.error ? (
                                <div className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
                                    {String((preview.error as any)?.message ?? preview.error)}
                                </div>
                            ) : null}
                            <div className="flex justify-center rounded-lg border bg-muted/40 p-4">
                                {preview.data ? (
                                    <iframe
                                        title={t`Email preview`}
                                        srcDoc={preview.data.previewEmail.html}
                                        sandbox=""
                                        className="h-[75vh] rounded-md border bg-white shadow-sm transition-[width]"
                                        style={{ width: WIDTHS[width] }}
                                    />
                                ) : (
                                    <div className="flex h-[40vh] items-center text-sm text-muted-foreground">
                                        {preview.isFetching ? (
                                            <Trans>Rendering…</Trans>
                                        ) : (
                                            <Trans>No preview</Trans>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </PageBlock>
                </PageLayout>
            </PermissionGuard>
        </Page>
    );
}

/** The settings that differ from what is stored. A cleared setting is sent as null, which removes it. */
function diff(stored: EmailDesignValues, values: EmailDesignValues): EmailDesignValues {
    const changes: EmailDesignValues = {};
    for (const name of new Set([...Object.keys(stored), ...Object.keys(values)])) {
        const before = stored[name] ?? null;
        const after = values[name] === '' || values[name] == null ? null : values[name];
        if (before !== after) {
            changes[name] = after;
        }
    }
    return changes;
}

/**
 * The settings that can be previewed: half-typed values, such as `#12`, would make the server reject
 * the whole preview, so they are left out until they are valid. Saving still reports them.
 */
function previewableDesign(values: EmailDesignValues, data: EmailDesignData | undefined): EmailDesignValues {
    const result: EmailDesignValues = {};
    for (const field of data?.fields ?? []) {
        const value = values[field.name];
        if (value != null && value !== '' && isComplete(field.kind, value, field.min, field.max)) {
            result[field.name] = value;
        }
    }
    return result;
}

function isComplete(
    kind: string,
    value: EmailDesignValue,
    min?: number | null,
    max?: number | null,
): boolean {
    if (kind === 'color') {
        return /^#[0-9a-f]{6}$/i.test(String(value));
    }
    if (kind === 'url') {
        return /^https?:\/\/[^\s"'<>()]+$/.test(String(value));
    }
    if (kind === 'number') {
        return Number.isInteger(value) && Number(value) >= (min ?? 0) && Number(value) <= (max ?? Infinity);
    }
    return true;
}

function useDebounced<T>(value: T, ms: number): T {
    const key = JSON.stringify(value);
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const handle = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(handle);
    }, [key]);
    return debounced;
}

export const emailDesignRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'email-design',
        url: '/emails/design',
        title: /* i18n*/ 'Email design',
        order: 451,
        requiresPermission: 'ReadSettings',
    },
    path: '/emails/design',
    loader: () => ({ breadcrumb: () => <Trans>Email design</Trans> }),
    component: () => <EmailDesignPage />,
};
