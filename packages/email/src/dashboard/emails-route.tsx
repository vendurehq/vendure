import { Trans } from '@lingui/react/macro';
import {
    api,
    DashboardRouteDefinition,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    PermissionGuard,
    useQuery,
} from '@vendure/dashboard';
import { useState } from 'react';

import { EmailListBlock } from './components/email-list-block';
import { EmailOutboxBlock } from './components/email-outbox-block';
import { EmailPreviewBlock } from './components/email-preview-block';
import { EmailOverviewResult, emailOverviewQuery } from './email.graphql';

function initialParam(name: string) {
    return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

function EmailsPage() {
    const [selectedType, setSelectedType] = useState<string | undefined>(() => initialParam('type'));
    const { data } = useQuery<EmailOverviewResult>({
        queryKey: ['emailOverview'],
        queryFn: () => api.query(emailOverviewQuery),
    });
    const emails = data?.emailOverview.emails ?? [];
    const selected = emails.find(e => e.type === selectedType) ?? emails[0];

    const select = (type: string) => {
        setSelectedType(type);
        const url = new URL(window.location.href);
        url.searchParams.set('type', type);
        window.history.replaceState(window.history.state, '', url);
    };

    return (
        <Page pageId="emails">
            <PageTitle>
                <Trans>Emails</Trans>
            </PageTitle>
            <PermissionGuard requires={['ReadSettings']}>
                <PageLayout>
                    <PageBlock column="side" blockId="email-list" title={<Trans>Emails</Trans>}>
                        <EmailListBlock emails={emails} selectedType={selected?.type} onSelect={select} />
                    </PageBlock>
                    <PageBlock column="main" blockId="email-preview" title={selected?.label ?? <Trans>Preview</Trans>}>
                        {selected ? <EmailPreviewBlock key={selected.type} email={selected} initialOrderCode={initialParam('order')} /> : null}
                    </PageBlock>
                    {data?.emailOverview.devMode ? (
                        <PageBlock
                            column="main"
                            blockId="email-outbox"
                            title={<Trans>Outbox</Trans>}
                            description={<Trans>Emails written by dev mode instead of being sent.</Trans>}
                        >
                            <EmailOutboxBlock />
                        </PageBlock>
                    ) : null}
                </PageLayout>
            </PermissionGuard>
        </Page>
    );
}

export const emailsRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'emails',
        url: '/emails',
        title: /* i18n*/ 'Emails',
        order: 450,
        requiresPermission: 'ReadSettings',
    },
    path: '/emails',
    loader: () => ({ breadcrumb: () => <Trans>Emails</Trans> }),
    component: () => <EmailsPage />,
};
