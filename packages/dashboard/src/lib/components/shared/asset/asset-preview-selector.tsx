import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { PreviewPreset } from './asset-preview.js';

export interface AssetPreviewSelectorProps {
    size: PreviewPreset;
    setSize: (size: PreviewPreset) => void;
    width: number;
    height: number;
}

export function AssetPreviewSelector({ size, setSize, width, height }: Readonly<AssetPreviewSelectorProps>) {
    return (
        <div className="flex items-center gap-2">
            <Select
                items={{
                    tiny: 'Tiny',
                    thumb: 'Thumb',
                    small: 'Small',
                    medium: 'Medium',
                    large: 'Large',
                    full: 'Full Size',
                }}
                value={size}
                onValueChange={value => setSize(value as PreviewPreset)}
            >
                <SelectTrigger>
                    <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="tiny">Tiny</SelectItem>
                    <SelectItem value="thumb">Thumb</SelectItem>
                    <SelectItem value="small">Small</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                    <SelectItem value="full">Full Size</SelectItem>
                </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
                {width} x {height}
            </p>
        </div>
    );
}
