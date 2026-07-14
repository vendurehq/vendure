import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/vdb/components/ui/dialog.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { DownloadIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface ApiKeySecretDialogProps {
    open: boolean;
    apiKey: string;
    lookupId?: string;
    onClose: () => void;
}

function downloadAsEnvFile(apiKey: string, lookupId?: string) {
    const lines = [`VENDURE_API_KEY=${apiKey}`];
    if (lookupId) {
        lines.push(`VENDURE_API_KEY_LOOKUP_ID=${lookupId}`);
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vendure-api-key.env';
    a.click();
    URL.revokeObjectURL(url);
}

export function ApiKeySecretDialog({ open, apiKey, lookupId, onClose }: ApiKeySecretDialogProps) {
    const [confirmed, setConfirmed] = useState(false);
    const { t } = useLingui();

    useEffect(() => {
        if (open) {
            setConfirmed(false);
        }
    }, [open]);

    // Warn user before leaving while the secret is still visible
    useEffect(() => {
        if (!open) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [open]);

    const handleDismissAttempt = (val: boolean) => {
        if (!val && !confirmed) {
            toast.info(t`Please confirm you have saved the API key before closing.`);
            return;
        }
        if (!val && confirmed) {
            onClose();
        }
    };

    if (!open) return null;

    return (
        <Dialog open={open} onOpenChange={handleDismissAttempt}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle><Trans>Your API Key</Trans></DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div
                        className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3"
                        role="alert"
                        aria-live="assertive"
                    >
                        <TriangleAlertIcon className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                        <p className="text-sm">
                            <Trans>
                                This is the only time the full API key will be displayed.
                                Copy or download it now — it cannot be retrieved later.
                            </Trans>
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium"><Trans>API Key</Trans></label>
                        <div className="rounded-md border bg-muted/50 p-3">
                            <CopyableText value={apiKey}>
                                <code className="font-mono text-xs break-all select-all">{apiKey}</code>
                            </CopyableText>
                        </div>
                    </div>

                    {lookupId && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium"><Trans>Lookup ID</Trans></label>
                            <CopyableText value={lookupId}>
                                <code className="font-mono text-xs">{lookupId}</code>
                            </CopyableText>
                        </div>
                    )}

                    <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => downloadAsEnvFile(apiKey, lookupId)}
                    >
                        <DownloadIcon />
                        <Trans>Download as .env file</Trans>
                    </Button>

                    <div className="flex items-center gap-2 pt-2">
                        <Checkbox
                            id="confirm-saved"
                            checked={confirmed}
                            onCheckedChange={val => setConfirmed(val === true)}
                        />
                        <label htmlFor="confirm-saved" className="text-sm cursor-pointer select-none">
                            <Trans>I have saved this API key</Trans>
                        </label>
                    </div>
                </div>

                <DialogFooter>
                    <Button onClick={onClose} disabled={!confirmed}>
                        <Trans>Close</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
