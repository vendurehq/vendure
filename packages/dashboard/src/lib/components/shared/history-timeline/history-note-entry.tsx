import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { HistoryEntry, HistoryEntryProps } from '@/vdb/framework/history-entry/history-entry.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { EllipsisIcon, PencilIcon, TrashIcon } from 'lucide-react';

interface HistoryNoteEntryProps extends Readonly<HistoryEntryProps> {
    onEditNote?: (noteId: string, note: string, isPrivate: boolean) => void;
    onDeleteNote?: (noteId: string) => void;
}

export function HistoryNoteEntry(props: HistoryNoteEntryProps) {
    const { entry, isPrimary, onEditNote, onDeleteNote } = props;
    const { t } = useLingui();
    return (
        <HistoryEntry {...props}>
            <div className={isPrimary ? 'space-y-2' : 'space-y-1'}>
                <div className="space-y-1">
                    <p className={`${isPrimary ? 'text-sm' : 'text-xs'} text-foreground`}>
                        {entry.data.note}
                    </p>
                </div>
                {onEditNote && onDeleteNote && (
                    <div className="flex items-center gap-2">
                        <Badge variant={entry.isPublic ? 'outline' : 'default'} className="text-xs">
                            {entry.isPublic ? <Trans>Public</Trans> : <Trans>Private</Trans>}
                        </Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={
                                    <Button variant="ghost" size="icon-xs" aria-label={t`Note actions`} />
                                }
                            >
                                <EllipsisIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    onClick={() => {
                                        onEditNote(entry.id, entry.data.note, !entry.isPublic);
                                    }}
                                >
                                    <PencilIcon />
                                    <Trans>Edit</Trans>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => onDeleteNote(entry.id)}
                                >
                                    <TrashIcon />
                                    <Trans>Delete</Trans>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>
        </HistoryEntry>
    );
}
