import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { getDashboardActionBarItems } from '@/vdb/framework/layout-engine/layout-extensions.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { createAssetsDocument } from './asset-documents.js';
import { Asset, AssetGallery } from './asset-gallery.js';

/**
 * @description
 * Props for the {@link AssetPickerDialog} component.
 *
 * @docsCategory components
 * @docsPage AssetPickerDialog
 */
interface AssetPickerDialogProps {
    /**
     * @description
     * Whether the dialog is open.
     */
    open: boolean;
    /**
     * @description
     * The function to call when the dialog is closed.
     */
    onClose: () => void;
    /**
     * @description
     * The function to call when assets are selected.
     */
    onSelect: (assets: Asset[]) => void;
    /**
     * @description
     * Whether multiple assets can be selected.
     */
    multiSelect?: boolean;
    /**
     * @description
     * The initial assets that should be selected.
     */
    initialSelectedAssets?: Asset[];
    /**
     * @description
     * The title of the dialog.
     */
    title?: string;
    /**
     * @description
     * An optional page ID for the dialog. When provided, this is exposed via the
     * internal `PageContext` so that extensions can register
     * {@link DashboardActionBarItem}s targeted at this specific dialog. Any
     * registered action bar items will be rendered in the dialog footer.
     */
    pageId?: string;
}

/**
 * @description
 * A dialog which allows the creation and selection of assets.
 *
 * @docsCategory components
 * @docsPage AssetPickerDialog
 * @docsWeight 0
 */
export function AssetPickerDialog({
    open,
    onClose,
    onSelect,
    multiSelect = false,
    initialSelectedAssets = [],
    title = 'Select Assets',
    pageId,
}: AssetPickerDialogProps) {
    const [selectedAssets, setSelectedAssets] = useState<Asset[]>(initialSelectedAssets);
    const pageContextValue = { pageId };
    const extensionActionBarItems = pageId
        ? getDashboardActionBarItems(pageId).filter(item => item.type !== 'dropdown')
        : [];
    const queryClient = useQueryClient();
    const { t } = useLingui();

    const handleAssetSelect = (assets: Asset[]) => {
        setSelectedAssets(assets);
    };

    // AssetGallery's own upload path opens a progress modal, which would nest
    // a second Dialog inside this picker's Dialog — Base UI dismiss events
    // from the inner one can then close the outer one too, discarding the
    // selection. Uploading directly here (no modal) avoids that entirely.
    const { mutate: createAssets } = useMutation({
        mutationFn: api.mutate(createAssetsDocument),
        onSuccess: (result: ResultOf<typeof createAssetsDocument>) => {
            const createdAssets = result.createAssets.filter(asset => asset.__typename === 'Asset');
            const failedAssets = result.createAssets.filter(asset => asset.__typename !== 'Asset');
            if (createdAssets.length > 0) {
                toast.success(t`Uploaded ${createdAssets.length} assets`);
            }
            if (failedAssets.length > 0) {
                toast.error(t`Failed to upload ${failedAssets.length} assets`, {
                    description: failedAssets.map(asset => ('message' in asset ? asset.message : '')).join(', '),
                });
            }
            void queryClient.invalidateQueries({ queryKey: ['AssetGallery'] });
        },
        onError: error => {
            toast.error(t`Failed to upload assets`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        },
    });

    const handleFilesDropped = useCallback(
        (droppedFiles: File[]) => {
            createAssets({ input: droppedFiles.map(file => ({ file })) });
        },
        [createAssets],
    );

    const handleConfirm = () => {
        onSelect(selectedAssets);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <PageContext.Provider value={pageContextValue}>
                <DialogContent className="sm:max-w-[800px] lg:max-w-[1000px] h-[85vh] p-0 flex flex-col">
                    <DialogHeader className="px-6 pt-6">
                        <DialogTitle>{multiSelect ? title : title.replace('Assets', 'Asset')}</DialogTitle>
                        <DialogDescription className="sr-only">
                            {multiSelect ? 'Browse and select one or more assets' : 'Browse and select an asset'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 pt-1">
                        <AssetGallery
                            onSelect={handleAssetSelect}
                            multiSelect="manual"
                            initialSelectedAssets={initialSelectedAssets}
                            fixedHeight={false}
                            displayBulkActions={false}
                            onFilesDropped={handleFilesDropped}
                        />
                    </div>

                    <DialogFooter className="px-6 pb-6 pt-4 border-t">
                        {extensionActionBarItems.map((item, index) => (
                            <PermissionGuard
                                key={item.id ?? `${item.pageId}-${index}`}
                                requires={item.requiresPermission ?? []}
                            >
                                <item.component context={pageContextValue} />
                            </PermissionGuard>
                        ))}
                        <Button variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button onClick={handleConfirm} disabled={selectedAssets.length === 0}>
                            {selectedAssets.length > 0 && multiSelect
                                ? `Select ${selectedAssets.length} Asset${selectedAssets.length > 1 ? 's' : ''}`
                                : 'Select Asset'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </PageContext.Provider>
        </Dialog>
    );
}
