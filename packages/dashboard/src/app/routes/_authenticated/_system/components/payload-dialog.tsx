import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';

type PayloadDialogProps = {
    payload: any;
    trigger: React.ReactElement;
    title?: string | React.ReactNode;
    description?: string | React.ReactNode;
    onOpenChange?: (open: boolean) => void;
};

export function PayloadDialog({
    payload,
    trigger,
    title,
    description,
    onOpenChange,
}: Readonly<PayloadDialogProps>) {
    return (
        <Dialog onOpenChange={open => onOpenChange?.(open)}>
            <DialogTrigger render={trigger} />
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[600px]">
                    <JsonViewer viewOnly data={payload} collapse={1} rootFontSize={12} />
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
