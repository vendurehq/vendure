import { ChannelColorSwatch } from '@/vdb/components/shared/channel-identity.js';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/vdb/components/ui/select.js';
import { ChannelColor, channelColorValues, useChannelColors } from '@/vdb/hooks/use-channel-colors.js';
import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';

const colorLabels: Record<ChannelColor, ReactNode> = {
    neutral: <Trans>Neutral</Trans>,
    'viz-1': <Trans>Color 1</Trans>,
    'viz-2': <Trans>Color 2</Trans>,
    'viz-3': <Trans>Color 3</Trans>,
    'viz-4': <Trans>Color 4</Trans>,
    'viz-5': <Trans>Color 5</Trans>,
};

function ChannelColorLabel({ color }: { color: ChannelColor }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ChannelColorSwatch color={color} />
            <span className="truncate">{colorLabels[color]}</span>
        </span>
    );
}

export function ChannelColorPicker({ channelId }: { channelId: string }) {
    const { getColor, setColor, canEdit, isAvailable, isSaving } = useChannelColors();

    if (!isAvailable || !canEdit) {
        return null;
    }

    const selectedColor = getColor(channelId);

    return (
        <Select
            value={selectedColor}
            onValueChange={value => value && setColor(channelId, value as ChannelColor)}
            disabled={isSaving}
        >
            <SelectTrigger className="w-full">
                <SelectValue>{(value: ChannelColor) => <ChannelColorLabel color={value} />}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
                {channelColorValues.map(color => (
                    <SelectItem key={color} value={color}>
                        <ChannelColorLabel color={color} />
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
