import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { Separator } from '@/vdb/components/ui/separator.js';
import { HistoryEntry, HistoryEntryProps } from '@/vdb/framework/history-entry/history-entry.js';
import { Trans } from '@lingui/react/macro';
import { MoreVerticalIcon, PencilIcon, TrashIcon } from 'lucide-react';

interface HistoryNoteEntryProps extends Readonly<HistoryEntryProps> {
    onEditNote?: (noteId: string, note: string, isPrivate: boolean) => void;
    onDeleteNote?: (noteId: string) => void;
}

export function HistoryNoteEntry(props: HistoryNoteEntryProps) {
    const { entry, isPrimary, onEditNote, onDeleteNote } = props;
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
                        <Badge variant={entry.isPublic ? 'outline' : 'secondary'} className="text-xs">
                            {entry.isPublic ? 'Public' : 'Private'}
                        </Badge>
                        <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-6 w-6 p-0" />}>
                                    <MoreVerticalIcon className="h-3 w-3" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    onClick={() => {
                                        onEditNote(entry.id, entry.data.note, !entry.isPublic);
                                    }}
                                    className="cursor-pointer"
                                >
                                    <PencilIcon className="mr-2 h-4 w-4" />
                                    <Trans>Edit</Trans>
                                </DropdownMenuItem>
                                <Separator className="my-1" />
                                <DropdownMenuItem
                                    onClick={() => onDeleteNote(entry.id)}
                                    className="cursor-pointer text-destructive focus:text-destructive"
                                >
                                    <TrashIcon className="mr-2 h-4 w-4" />
                                    <span>Delete</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>
        </HistoryEntry>
    );
}
