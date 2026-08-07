import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { ChannelColorPicker } from '@/vdb/components/shared/channel-color-picker.js';
import { ChannelIdentity } from '@/vdb/components/shared/channel-identity.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { useChannelColors } from '@/vdb/hooks/use-channel-colors.js';
import { Trans } from '@lingui/react/macro';

interface ChannelColorsDialogProps {
    channels: Array<{ id: string; code: string }>;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ChannelColorsDialog({ channels, open, onOpenChange }: ChannelColorsDialogProps) {
    const { getColor, canEdit, isAvailable } = useChannelColors();

    if (!isAvailable || !canEdit) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Customize channel colors</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Use a shared color marker to make channels easier to recognize.</Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="divide-y">
                    {channels.map(channel => (
                        <div key={channel.id} className="space-y-3 py-4 first:pt-1">
                            <div className="flex items-center gap-2 font-medium">
                                <ChannelIdentity color={getColor(channel.id)} />
                                <ChannelCodeLabel code={channel.code} />
                            </div>
                            <ChannelColorPicker channelId={channel.id} />
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
