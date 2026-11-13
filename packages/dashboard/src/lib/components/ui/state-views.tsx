import { useLingui } from '@lingui/react/macro';
import type { LoadingStateProps } from '@vendure-io/ui/components/molecules/state-views/loading-state';
import { LoadingState as BaseLoadingState } from '@vendure-io/ui/components/molecules/state-views/loading-state';

export { EmptyState } from '@vendure-io/ui/components/molecules/state-views/empty-state';
export type { EmptyStateProps } from '@vendure-io/ui/components/molecules/state-views/empty-state';
export { ErrorState } from '@vendure-io/ui/components/molecules/state-views/error-state';
export type { ErrorStateProps } from '@vendure-io/ui/components/molecules/state-views/error-state';
export { loadingStateVariants } from '@vendure-io/ui/components/molecules/state-views/loading-state';
export type { LoadingStateProps } from '@vendure-io/ui/components/molecules/state-views/loading-state';

export function LoadingState({ srLabel, ...props }: Readonly<LoadingStateProps>) {
    const { t } = useLingui();
    return <BaseLoadingState srLabel={srLabel ?? t`Loading…`} {...props} />;
}
