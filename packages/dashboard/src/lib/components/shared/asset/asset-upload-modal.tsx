import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Progress } from '@/vdb/components/ui/progress.js';
import { api, UploadErrorCode, UploadWithProgressResult } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Plural, Trans } from '@lingui/react/macro';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAssetsDocument } from './asset-documents.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

// A file can also be rejected by the server (e.g. wrong mime type) even
// though the request itself succeeded, so this extends the transport-level
// UploadErrorCode with that data-level outcome.
export type UploadItemErrorCode = UploadErrorCode | 'REJECTED';

interface FileUpload {
    file: File;
    status: UploadStatus;
    progress: number; // 0–100
    errorCode?: UploadItemErrorCode;
    errorDetail?: string;
}

export type UploadItemResult =
    | { success: true }
    | { success: false; code: UploadItemErrorCode; detail?: string };

export interface UploadSummary {
    succeededCount: number;
    failedCount: number;
}

const MAX_CONCURRENT_UPLOADS = 4;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isTerminalStatus(upload: FileUpload): boolean {
    return upload.status === 'done' || upload.status === 'error';
}

export function allUploadsFinished(uploads: FileUpload[]): boolean {
    return uploads.length > 0 && uploads.every(isTerminalStatus);
}

export function overallProgress(uploads: FileUpload[]): number {
    if (uploads.length === 0) return 0;
    const total = uploads.reduce((sum, upload) => sum + upload.progress, 0);
    return Math.round(total / uploads.length);
}

export function withUpdatedUpload(uploads: FileUpload[], index: number, patch: Partial<FileUpload>): FileUpload[] {
    return uploads.map((upload, i) => (i === index ? { ...upload, ...patch } : upload));
}

export function interpretUploadResult(
    result: UploadWithProgressResult<ResultOf<typeof createAssetsDocument>>,
): UploadItemResult {
    if (!result.success) {
        return { success: false, code: result.code, detail: result.detail };
    }
    const created = result.data.createAssets[0];
    if (created.__typename !== 'Asset') {
        return { success: false, code: 'REJECTED', detail: created.message };
    }
    return { success: true };
}

// Runs `worker` over `items` with at most `limit` running concurrently,
// rather than firing every upload at once (see MAX_CONCURRENT_UPLOADS).
export async function runWithConcurrencyLimit<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
    let cursor = 0;
    async function runNext(): Promise<void> {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index], index);
        return runNext();
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface AssetUploadModalProps {
    files: File[];
    open: boolean;
    onClose: () => void;
    onComplete: (summary: UploadSummary) => void;
}

export function AssetUploadModal({ files, open, onClose, onComplete }: AssetUploadModalProps) {
    const [fileUploads, setFileUploads] = useState<FileUpload[]>([]);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Latest-value refs so the upload effect below (deliberately scoped to
    // [open, files]) always calls the current onComplete/onClose rather than
    // whichever closure was captured when the upload started.
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open || !files.length) return;

        const initialUploads: FileUpload[] = files.map(file => ({
            file,
            status: 'queued',
            progress: 0,
        }));
        setFileUploads(initialUploads);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        async function uploadSingleFile(fileUpload: FileUpload, index: number): Promise<UploadItemResult> {
            setFileUploads(prev => withUpdatedUpload(prev, index, { status: 'uploading' }));

            const result = await api.uploadWithProgress<ResultOf<typeof createAssetsDocument>>(
                createAssetsDocument,
                { input: [{ file: fileUpload.file }] },
                {
                    signal: controller.signal,
                    onProgress: percent =>
                        setFileUploads(prev => withUpdatedUpload(prev, index, { progress: percent })),
                },
            );

            const outcome = interpretUploadResult(result);
            setFileUploads(prev =>
                withUpdatedUpload(
                    prev,
                    index,
                    outcome.success
                        ? { status: 'done', progress: 100 }
                        : { status: 'error', errorCode: outcome.code, errorDetail: outcome.detail },
                ),
            );
            return outcome;
        }

        async function uploadAll(): Promise<void> {
            const outcomes: UploadItemResult[] = new Array(initialUploads.length);
            await runWithConcurrencyLimit(initialUploads, MAX_CONCURRENT_UPLOADS, async (upload, index) => {
                outcomes[index] = await uploadSingleFile(upload, index);
            });

            // Report the summary even when aborted: files that finished
            // before the cancel already exist on the server and need the
            // gallery to refresh, even though the batch as a whole didn't
            // fully succeed.
            const succeededCount = outcomes.filter(o => o.success).length;
            onCompleteRef.current({ succeededCount, failedCount: outcomes.length - succeededCount });
            if (!controller.signal.aborted && succeededCount === outcomes.length) {
                onCloseRef.current();
            }
        }

        uploadAll().catch(error => {
            console.error('Unexpected error while uploading assets:', error);
        });

        return () => {
            controller.abort();
        };
    }, [open, files]);

    const handleCancel = useCallback(() => {
        abortControllerRef.current?.abort();
        onClose();
    }, [onClose]);

    const doneCount = fileUploads.filter(u => u.status === 'done').length;
    const finished = allUploadsFinished(fileUploads);

    return (
        <Dialog open={open} onOpenChange={isOpen => { if (!isOpen && finished) onClose(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Uploading assets</Trans>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        <Plural
                            value={fileUploads.length}
                            one={`Upload progress for ${fileUploads.length} file`}
                            other={`Upload progress for ${fileUploads.length} files`}
                        />
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-1">
                    <div className="flex justify-between text-sm text-muted-foreground">
                        <span>
                            <Trans>{doneCount} of {fileUploads.length} done</Trans>
                        </span>
                        <span>{overallProgress(fileUploads)}%</span>
                    </div>
                    <Progress value={overallProgress(fileUploads)} />
                </div>

                <div className="space-y-3 max-h-72 overflow-y-auto">
                    {fileUploads.map((upload, index) => (
                        <div key={index} className="space-y-1">
                            <div className="flex items-center gap-2 text-sm">
                                <UploadStatusIcon status={upload.status} />
                                <span className="flex-1 truncate">{upload.file.name}</span>
                                <span className="text-muted-foreground shrink-0">{upload.progress}%</span>
                            </div>
                            <Progress value={upload.progress} />
                            {upload.errorCode && (
                                <p className="text-xs text-destructive">
                                    <UploadErrorText code={upload.errorCode} detail={upload.errorDetail} />
                                </p>
                            )}
                        </div>
                    ))}
                </div>

                <DialogFooter>
                    {!finished && (
                        <Button variant="outline" onClick={handleCancel}>
                            <Trans>Cancel</Trans>
                        </Button>
                    )}
                    <Button onClick={onClose} disabled={!finished}>
                        {finished ? <Trans>Close</Trans> : <Trans>Uploading...</Trans>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function UploadStatusIcon({ status }: { status: UploadStatus }) {
    switch (status) {
        case 'queued':    return <Clock        className="h-4 w-4 text-muted-foreground shrink-0" />;
        case 'uploading': return <Loader2      className="h-4 w-4 animate-spin text-primary shrink-0" />;
        case 'done':      return <CheckCircle2 className="h-4 w-4 text-success shrink-0" />;
        case 'error':     return <XCircle      className="h-4 w-4 text-destructive shrink-0" />;
    }
}

function UploadErrorText({ code, detail }: { code: UploadItemErrorCode; detail?: string }) {
    switch (code) {
        case 'FILE_TOO_LARGE':
            return <Trans>File exceeds the server upload size limit</Trans>;
        case 'HTTP_ERROR':
            return <Trans>Upload failed (HTTP {detail})</Trans>;
        case 'NETWORK_ERROR':
            return <Trans>Upload failed — check your connection</Trans>;
        case 'TIMEOUT':
            return <Trans>Upload timed out</Trans>;
        case 'ABORTED':
            return <Trans>Upload cancelled</Trans>;
        case 'INVALID_RESPONSE':
            return <Trans>Upload failed — invalid server response</Trans>;
        case 'SERVER_ERROR':
        case 'REJECTED':
            // Server-provided message text — already human-readable, not ours to translate.
            return <>{detail}</>;
    }
}
