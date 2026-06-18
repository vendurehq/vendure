import { formatFileSize } from '@/vdb/lib/utils.js';

import { Label } from '@/vdb/components/ui/label.js';
import { AssetFragment } from '@/vdb/graphql/fragments.js';
import { ExternalLink } from 'lucide-react';

export interface AssetPropertiesProps {
    asset: AssetFragment;
}

export function AssetProperties({ asset }: Readonly<AssetPropertiesProps>) {
    return (
        <div className="space-y-4">
            <div>
                <Label>Source File</Label>
                <a
                    href={asset.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                >
                    {asset.source.split('/').pop()}
                    <ExternalLink className="ml-1 h-3 w-3 inline" />
                </a>
            </div>

            <div>
                <Label>File Size</Label>
                <p className="text-sm text-muted-foreground">{formatFileSize(asset.fileSize)}</p>
            </div>

            <div>
                <Label>Dimensions</Label>
                <p className="text-sm text-muted-foreground">
                    {asset.width} x {asset.height}
                </p>
            </div>
        </div>
    );
}
