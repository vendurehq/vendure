import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Trans } from '@lingui/react/macro';
import { ComponentProps } from 'react';
import { AssetPreview, AssetWithTags } from './asset-preview.js';

interface AssetPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    asset: AssetWithTags;
    assets?: AssetWithTags[];
    customFields?: any[];
    onAssetUpdated?: ComponentProps<typeof AssetPreview>['onAssetUpdated'];
}

export function AssetPreviewDialog({
    open,
    onOpenChange,
    asset,
    assets,
    customFields,
    onAssetUpdated,
}: AssetPreviewDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px] lg:max-w-[95vw] w-[95vw] p-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>
                        <Trans>Asset</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Preview of {asset.name}</Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="h-full p-6">
                    <AssetPreview
                        asset={asset}
                        assets={assets}
                        customFields={customFields}
                        onAssetUpdated={onAssetUpdated}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
