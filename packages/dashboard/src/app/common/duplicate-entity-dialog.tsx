import { ConfigurableOperationInput as ConfigurableOperationInputComponent } from '@/vdb/components/shared/configurable-operation-input.js';
import { getInitialConfigArgValue } from '@/vdb/components/shared/configurable-operation-utils.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { api } from '@/vdb/graphql/api.js';
import { getEntityDuplicatorsDocument } from '@/vdb/graphql/common-operations.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import React, { useState } from 'react';

interface DuplicateEntityDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityType: 'Product' | 'Collection' | 'Facet' | 'Promotion';
    entityName: string;
    entities: Array<{ id: string; name?: string }>;
    duplicatorCode: string;
    onConfirm: (duplicatorInput: ConfigurableOperationInput) => void;
}

export function DuplicateEntityDialog({
    open,
    onOpenChange,
    entityType,
    entityName,
    duplicatorCode,
    onConfirm,
}: Readonly<DuplicateEntityDialogProps>) {
    const [selectedDuplicator, setSelectedDuplicator] = useState<ConfigurableOperationInput | undefined>();

    const { data } = useQuery({
        queryKey: ['entityDuplicators'],
        queryFn: () => api.query(getEntityDuplicatorsDocument),
        staleTime: 1000 * 60 * 60 * 5,
    });

    // Find the duplicator that matches the provided code and supports this entity type
    const matchingDuplicator = data?.entityDuplicators?.find(
        duplicator => duplicator.code === duplicatorCode && duplicator.forEntities.includes(entityType),
    );

    // Auto-initialize the duplicator when found
    React.useEffect(() => {
        if (matchingDuplicator && !selectedDuplicator) {
            setSelectedDuplicator({
                code: matchingDuplicator.code,
                arguments:
                    matchingDuplicator.args?.map(arg => ({
                        name: arg.name,
                        value: getInitialConfigArgValue(arg),
                    })) || [],
            });
        }
    }, [matchingDuplicator, selectedDuplicator]);

    const onDuplicatorValueChange = (newVal: ConfigurableOperationInput) => {
        setSelectedDuplicator(newVal);
    };

    const handleConfirm = () => {
        if (!selectedDuplicator) return;
        onConfirm(selectedDuplicator);
        onOpenChange(false);
        setSelectedDuplicator(undefined);
    };

    const handleCancel = () => {
        onOpenChange(false);
        setSelectedDuplicator(undefined);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Duplicate {entityName.toLowerCase()}s</Trans>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        <Trans>Configure duplication settings for {entityName.toLowerCase()}s</Trans>
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {selectedDuplicator && matchingDuplicator && (
                        <ConfigurableOperationInputComponent
                            operationDefinition={matchingDuplicator}
                            value={selectedDuplicator}
                            onChange={onDuplicatorValueChange}
                            removable={false}
                        />
                    )}

                    {!matchingDuplicator && (
                        <div className="text-sm text-muted-foreground">
                            <Trans>
                                No duplicator found with code "{duplicatorCode}" for {entityName}s
                            </Trans>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleConfirm} disabled={!selectedDuplicator}>
                        <Trans>Duplicate</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
