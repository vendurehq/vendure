import { Page, PageBlock, PageLayout, PageTitle } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { useRouter } from '@tanstack/react-router';
import { Button } from '../ui/button.js';
import { ErrorState } from '../ui/state-views.js';

export interface ErrorPageProps {
    message: string;
}

/**
 * @description
 * A generic error page that displays an error message.
 */
export function ErrorPage({ message }: Readonly<ErrorPageProps>) {
    const router = useRouter();
    return (
        <Page pageId="error-page">
            <PageTitle>
                <Trans>Error</Trans>
            </PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="error-message">
                    <ErrorState
                        title={<Trans>We couldn't load this page</Trans>}
                        description={message}
                    >
                        <Button variant="outline" size="sm" onClick={() => router.history.back()}>
                            <Trans>Go back</Trans>
                        </Button>
                    </ErrorState>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
