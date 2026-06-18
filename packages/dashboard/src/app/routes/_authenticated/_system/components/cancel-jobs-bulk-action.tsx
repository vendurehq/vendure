import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import { cancelJobDocument } from '../job-queue.graphql.js';

export const CancelJobsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { refetchPaginatedList } = usePaginatedList();
    const { t } = useLingui();

    const cancellableJobs = selection.filter(job => job.state === 'RUNNING' || job.state === 'PENDING');
    const cancellableCount = cancellableJobs.length;

    const { mutate, isPending } = useMutation({
        mutationFn: async () => {
            const results = await Promise.allSettled(
                cancellableJobs.map(job => api.mutate(cancelJobDocument, { jobId: job.id })),
            );

            const fulfilled = results.filter(r => r.status === 'fulfilled').length;
            const rejected = results.filter(r => r.status === 'rejected').length;

            return { fulfilled, rejected };
        },
        onSuccess: ({ fulfilled, rejected }) => {
            if (fulfilled > 0) {
                toast.success(
                    plural(fulfilled, {
                        one: t`Successfully cancelled ${fulfilled} job`,
                        other: t`Successfully cancelled ${fulfilled} jobs`,
                    }),
                );
            }
            if (rejected > 0) {
                toast.error(
                    plural(rejected, {
                        one: t`Failed to cancel ${rejected} job`,
                        other: t`Failed to cancel ${rejected} jobs`,
                    }),
                );
            }

            refetchPaginatedList();
            table.resetRowSelection();
        },
    });

    if (cancellableCount === 0) {
        return null;
    }

    return (
        <DataTableBulkActionItem
            requiresPermission={['DeleteSettings', 'DeleteSystem']}
            onClick={() => mutate()}
            disabled={isPending}
            label={
                <Plural
                    value={cancellableCount}
                    one={`Cancel ${cancellableCount} job`}
                    other={`Cancel ${cancellableCount} jobs`}
                />
            }
            confirmationText={
                <Plural
                    value={cancellableCount}
                    one={`Are you sure you want to cancel ${cancellableCount} job? This action cannot be undone.`}
                    other={`Are you sure you want to cancel ${cancellableCount} jobs? This action cannot be undone.`}
                />
            }
            icon={Ban}
            className="text-destructive"
        />
    );
};
