import { Trans, useLingui } from '@lingui/react/macro';
import {
    api,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useLocalFormat,
    useQuery,
} from '@vendure/dashboard';
import { useState } from 'react';

import { EmailOutboxResult, emailOutboxQuery } from '../email.graphql';

type OutboxEntry = EmailOutboxResult['emailOutbox'][number];

/**
 * The emails dev mode wrote instead of sending, newest first. Selecting one shows it.
 */
export function EmailOutboxBlock() {
    const { t } = useLingui();
    const { formatDate } = useLocalFormat();
    const [open, setOpen] = useState<OutboxEntry | undefined>();
    const { data, isLoading } = useQuery<EmailOutboxResult>({
        queryKey: ['emailOutbox'],
        queryFn: () => api.query(emailOutboxQuery, { limit: 50 }),
        refetchInterval: 5000,
    });
    const entries = data?.emailOutbox ?? [];

    if (!isLoading && !entries.length) {
        return (
            <p className="text-sm text-muted-foreground">
                <Trans>Nothing sent yet.</Trans>
            </p>
        );
    }

    return (
        <>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>
                            <Trans>Sent</Trans>
                        </TableHead>
                        <TableHead>
                            <Trans>Status</Trans>
                        </TableHead>
                        <TableHead>
                            <Trans>Email</Trans>
                        </TableHead>
                        <TableHead>
                            <Trans>To</Trans>
                        </TableHead>
                        <TableHead>
                            <Trans>Subject</Trans>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {entries.map(entry => (
                        <TableRow
                            key={entry.id}
                            className="cursor-pointer"
                            onClick={() => entry.html && setOpen(entry)}
                        >
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                                {formatDate(entry.sentAt, { dateStyle: 'short', timeStyle: 'medium' })}
                            </TableCell>
                            <TableCell>
                                <StatusBadge tone={entry.status === 'sent' ? 'success' : 'critical'}>
                                    {entry.status === 'sent' ? t`Sent` : t`Failed`}
                                </StatusBadge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{entry.type}</TableCell>
                            <TableCell>{entry.recipient}</TableCell>
                            <TableCell>
                                {entry.subject}
                                {entry.error ? <div className="text-xs text-destructive">{entry.error}</div> : null}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {open ? (
                <Dialog open onOpenChange={value => !value && setOpen(undefined)}>
                    <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                            <DialogTitle>{open.subject}</DialogTitle>
                            <DialogDescription>
                                <Trans>To {open.recipient}</Trans>
                            </DialogDescription>
                        </DialogHeader>
                        <iframe
                            title={t`Sent email`}
                            srcDoc={open.html ?? ''}
                            sandbox=""
                            className="h-[65vh] w-full rounded-md border bg-white"
                        />
                    </DialogContent>
                </Dialog>
            ) : null}
        </>
    );
}
