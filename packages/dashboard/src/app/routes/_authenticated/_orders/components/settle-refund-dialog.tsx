import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';

type SettleRefundDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSettle: (transactionId: string) => void;
    isLoading?: boolean;
};

export function SettleRefundDialog({
                                       open,
                                       onOpenChange,
                                       onSettle,
                                       isLoading,
                                   }: Readonly<SettleRefundDialogProps>) {
    const [transactionId, setTransactionId] = useState('');

    const handleSettle = () => {
        if (transactionId.trim()) {
            onSettle(transactionId.trim());
            setTransactionId('');
        }
    };

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) {
            setTransactionId('');
        }
        onOpenChange(newOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Settle refund</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Enter the transaction ID for this refund settlement</Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="transaction-id">
                            <Trans>Transaction ID</Trans>
                        </Label>
                        <Input
                            id="transaction-id"
                            value={transactionId}
                            onChange={e => setTransactionId(e.target.value)}
                            placeholder="Enter transaction ID..."
                            disabled={isLoading}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleSettle} disabled={!transactionId.trim() || isLoading}>
                        <Trans>Settle refund</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
