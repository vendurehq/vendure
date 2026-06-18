import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Textarea } from '@/vdb/components/ui/textarea.js';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';
import { HistoryNoteCheckbox } from './history-note-checkbox.js';

interface NoteEditorProps {
    note: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onNoteChange: (noteId: string, note: string, isPrivate: boolean) => void;
    noteId: string;
    isPrivate: boolean;
}

export function HistoryNoteEditor({
    open,
    onOpenChange,
    note,
    onNoteChange,
    noteId,
    isPrivate,
}: NoteEditorProps) {
    const [value, setValue] = useState(note);
    const [noteIsPrivate, setNoteIsPrivate] = useState(isPrivate);
    const handleSave = () => {
        onNoteChange(noteId, value, noteIsPrivate);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Edit Note</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Update the note content or visibility</Trans>
                    </DialogDescription>
                </DialogHeader>
                <Textarea value={value} onChange={e => setValue(e.target.value)} />
                <HistoryNoteCheckbox value={noteIsPrivate} onChange={setNoteIsPrivate} />
                <DialogFooter>
                    <Button onClick={() => handleSave()}>
                        <Trans>Save</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
