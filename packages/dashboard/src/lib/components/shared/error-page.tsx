import { Page, PageBlock, PageLayout, PageTitle } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { Link, useRouter } from '@tanstack/react-router';
import { Button } from '../ui/button.js';
import {
    AccessDeniedIllustration,
    ErrorIllustration,
    NotFoundIllustration,
} from '../ui/illustrations.js';
import { ErrorState } from '../ui/state-views.js';
import { NotFoundError } from './not-found-error.js';
import { type ReactNode } from 'react';

export { NotFoundError };

export type ErrorKind = 'not-found' | 'forbidden' | 'error';

/**
 * @description
 * Derives the {@link ErrorKind} from the value thrown by a route loader.
 *
 * GraphQL failures from `api.query`/`api.mutate` surface as
 * `GraphQLRequestError`, which carries the Vendure error code in
 * `extensions.code` (e.g. `FORBIDDEN`) and the HTTP status in `response.status`.
 * A missing entity is signalled by a {@link NotFoundError} thrown by
 * `detailPageRouteLoader`.
 */
export function getErrorKind(error: unknown): ErrorKind {
    if (error instanceof NotFoundError) {
        return 'not-found';
    }
    const code = (error as any)?.extensions?.code;
    if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') {
        return 'forbidden';
    }
    const status = (error as any)?.response?.status;
    if (status === 403 || status === 401) {
        return 'forbidden';
    }
    if (status === 404) {
        return 'not-found';
    }
    return 'error';
}

export interface ErrorPageProps {
    /**
     * @description
     * The value thrown by the route `errorComponent`. The error kind
     * (not-found / forbidden / generic) is derived from its shape via
     * {@link getErrorKind}, unless an explicit `kind` is provided.
     */
    error?: unknown;
    /**
     * @description
     * Overrides the kind derived from `error`.
     */
    kind?: ErrorKind;
    /**
     * @description
     * Overrides the description shown to the user. Falls back to the error's
     * message.
     */
    message?: string;
}

/**
 * @description
 * A full-page error state that adapts its illustration, copy and actions to the
 * kind of failure. Not-found and permission errors offer navigation ("Go back"
 * / "Go to dashboard") rather than a retry, while generic failures keep a retry
 * action.
 */
export function ErrorPage({ error, kind, message }: Readonly<ErrorPageProps>) {
    const router = useRouter();
    const resolvedKind = kind ?? getErrorKind(error);
    const errorMessage = message ?? (error instanceof Error ? error.message : undefined);

    const goBack = (
        <Button variant="outline" size="sm" onClick={() => router.history.back()}>
            <Trans>Go back</Trans>
        </Button>
    );
    const goToDashboard = (
        <Button variant="ghost" size="sm" render={<Link to="/" />}>
            <Trans>Go to dashboard</Trans>
        </Button>
    );

    let title: ReactNode;
    let state: ReactNode;
    switch (resolvedKind) {
        case 'not-found':
            title = <Trans>Not found</Trans>;
            state = (
                <ErrorState
                    illustration={<NotFoundIllustration />}
                    title={<Trans>Page not found</Trans>}
                    description={
                        errorMessage ?? (
                            <Trans>
                                The page you are looking for does not exist or may have been moved.
                            </Trans>
                        )
                    }
                >
                    {goBack}
                    {goToDashboard}
                </ErrorState>
            );
            break;
        case 'forbidden':
            title = <Trans>Access denied</Trans>;
            state = (
                <ErrorState
                    illustration={<AccessDeniedIllustration />}
                    title={<Trans>Access denied</Trans>}
                    description={<Trans>You do not have permission to view this page.</Trans>}
                >
                    {goBack}
                    {goToDashboard}
                </ErrorState>
            );
            break;
        default:
            title = <Trans>Error</Trans>;
            state = (
                <ErrorState
                    illustration={<ErrorIllustration />}
                    title={<Trans>We couldn't load this page</Trans>}
                    description={errorMessage}
                    onRetry={() => router.invalidate()}
                >
                    {goBack}
                </ErrorState>
            );
    }

    return (
        <Page pageId="error-page">
            <PageTitle>{title}</PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="error-message">
                    {state}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
