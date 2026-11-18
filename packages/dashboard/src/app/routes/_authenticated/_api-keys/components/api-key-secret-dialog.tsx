import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/vdb/components/ui/dialog.js';
import { IssuedSecret, IssuedSecretFooter, useIssuedSecretGuard } from '@/vdb/components/ui/issued-secret.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { DownloadIcon } from 'lucide-react';
import { useEffect } from 'react';

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

/**
 * Shown once, right after an API key is created. The key is never rendered: it is copied with a
 * button or downloaded as a .env file. Closing before either shows a warning first.
 */
export function ApiKeySecretDialog({ open, apiKey, lookupId, onClose }: ApiKeySecretDialogProps) {
    const { t } = useLingui();
    const guard = useIssuedSecretGuard(onClose);

    // Warn before leaving the page while the key has not been copied.
    useEffect(() => {
        if (!open || guard.copied) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [open, guard.copied]);

    if (!open) return null;

    return (
        <Dialog open={open} onOpenChange={guard.onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Your API key</Trans>
                    </DialogTitle>
                </DialogHeader>
                <IssuedSecret
                    guard={guard}
                    value={apiKey}
                    secretName={t`API key`}
                    copyLabel={t`Copy API key`}
                    copiedLabel={t`Copied`}
                    notice={t`You can copy or download the API key only now.`}
                    fallbackLabel={t`API key`}
                    fallbackDescription={t`The clipboard is not available. Select the API key and copy it by hand.`}
                    warningTitle={t`The API key is not copied`}
                    warningDescription={t`You cannot copy it after you close. Copy or download it now, or close without copying.`}
                >
                    {lookupId && (
                        <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground text-xs">
                                <Trans>Lookup ID</Trans>
                            </span>
                            <CopyableText value={lookupId}>
                                <code className="font-mono text-xs">{lookupId}</code>
                            </CopyableText>
                        </div>
                    )}
                </IssuedSecret>
                <div>
                    {/* A download is a second way to take the key, so it counts as a copy for the close guard. */}
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            downloadAsEnvFile(apiKey, lookupId);
                            guard.markCopied();
                        }}
                    >
                        <DownloadIcon />
                        <Trans>Download as .env file</Trans>
                    </Button>
                </div>
                <IssuedSecretFooter
                    guard={guard}
                    doneLabel={t`Done`}
                    closeAnywayLabel={t`Close without copying`}
                />
            </DialogContent>
        </Dialog>
    );
}
