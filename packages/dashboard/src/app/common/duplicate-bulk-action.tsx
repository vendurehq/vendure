import { useMutation } from '@tanstack/react-query';
import { ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import { CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { api } from '@/vdb/graphql/api.js';
import { duplicateEntityDocument } from '@/vdb/graphql/common-operations.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { DuplicateEntityDialog } from './duplicate-entity-dialog.js';

interface DuplicateBulkActionProps {
    entityType: 'Product' | 'Collection' | 'Facet' | 'Promotion';
    duplicatorCode: string;
    requiredPermissions: string[];
    entityName: string;
    onSuccess?: () => void;
    selection: any[];
    table: any;
}

export function DuplicateBulkAction({
    entityType,
    duplicatorCode,
    requiredPermissions,
    entityName,
    onSuccess,
    selection,
    table,
}: Readonly<DuplicateBulkActionProps>) {
    const { refetchPaginatedList } = usePaginatedList();
    const { t } = useLingui();
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [progress, setProgress] = useState({ completed: 0, total: 0 });
    const [dialogOpen, setDialogOpen] = useState(false);

    const { mutateAsync } = useMutation({
        mutationFn: api.mutate(duplicateEntityDocument),
    });

    const handleStartDuplication = () => {
        if (isDuplicating) return;
        setDialogOpen(true);
    };

    const handleConfirmDuplication = async (duplicatorInput: ConfigurableOperationInput) => {
        if (isDuplicating) return;

        setIsDuplicating(true);
        setProgress({ completed: 0, total: selection.length });

        const results = {
            success: 0,
            failed: 0,
            errors: [] as string[],
        };

        try {
            // Process entities sequentially to avoid overwhelming the server
            for (let i = 0; i < selection.length; i++) {
                const entity = selection[i];

                try {
                    const result = await mutateAsync({
                        input: {
                            entityName: entityType,
                            entityId: entity.id,
                            duplicatorInput,
                        },
                    });

                    if ('newEntityId' in result.duplicateEntity) {
                        results.success++;
                    } else {
                        results.failed++;
                        const errorMsg =
                            result.duplicateEntity.message ||
                            result.duplicateEntity.duplicationError ||
                            'Unknown error';
                        results.errors.push(`${entityName} ${entity.name || entity.id}: ${errorMsg}`);
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push(
                        `${entityName} ${entity.name || entity.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    );
                }

                setProgress({ completed: i + 1, total: selection.length });
            }

            // Show results
            if (results.success > 0) {
                const count = results.success;
                toast.success(t`Successfully duplicated ${count} ${entityName}`);
            }
            if (results.failed > 0) {
                const errorMessage =
                    results.errors.length > 3
                        ? `${results.errors.slice(0, 3).join(', ')}... and ${results.errors.length - 3} more`
                        : results.errors.join(', ');
                toast.error(
                    `Failed to duplicate ${results.failed} ${entityName.toLowerCase()}s: ${errorMessage}`,
                );
            }

            if (results.success > 0) {
                refetchPaginatedList();
                table.resetRowSelection();
                onSuccess?.();
            }
        } finally {
            setIsDuplicating(false);
            setProgress({ completed: 0, total: 0 });
        }
    };

    return (
        <>
            <DataTableBulkActionItem
                requiresPermission={requiredPermissions}
                onClick={handleStartDuplication}
                label={
                    isDuplicating ? (
                        <Trans>
                            Duplicating... ({progress.completed}/{progress.total})
                        </Trans>
                    ) : (
                        <Trans>Duplicate</Trans>
                    )
                }
                icon={CopyIcon}
                closeOnClick={false}
            />
            <DuplicateEntityDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                entityType={entityType}
                entityName={entityName}
                entities={selection}
                duplicatorCode={duplicatorCode}
                onConfirm={handleConfirmDuplication}
            />
        </>
    );
}
