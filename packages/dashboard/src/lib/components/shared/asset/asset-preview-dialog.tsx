import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { AssetPreview, AssetWithTags } from './asset-preview.js';

interface AssetPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    asset: AssetWithTags;
    assets?: AssetWithTags[];
    customFields?: any[];
}

export function AssetPreviewDialog({
    open,
    onOpenChange,
    asset,
    assets,
    customFields,
}: AssetPreviewDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px] lg:max-w-[95vw] w-[95vw] p-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>Asset</DialogTitle>
                    <DialogDescription>Preview of {asset.name}</DialogDescription>
                </DialogHeader>
                <div className="h-full p-6">
                    <AssetPreview asset={asset} assets={assets} customFields={customFields} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
