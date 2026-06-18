import { Button } from '@/vdb/components/ui/button.js';
import { Textarea } from '@/vdb/components/ui/textarea.js';
import { useState } from 'react';
import { HistoryNoteCheckbox } from './history-note-checkbox.js';

interface HistoryNoteInputProps {
    onAddNote: (note: string, isPrivate: boolean) => void;
}

export function HistoryNoteInput({ onAddNote }: Readonly<HistoryNoteInputProps>) {
    const [note, setNote] = useState('');
    const [noteIsPrivate, setNoteIsPrivate] = useState(true);

    const handleAddNote = () => {
        if (note.trim()) {
            onAddNote(note, noteIsPrivate);
            setNote('');
        }
    };

    return (
        <div className="bg-muted/20 rounded-lg p-3 mb-4">
            <div className="flex flex-col space-y-2">
                <Textarea
                    placeholder="Add a note..."
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    className="min-h-[50px] resize-none bg-background/50 focus:bg-background transition-colors text-sm"
                />
                <div className="flex items-center justify-between">
                    <HistoryNoteCheckbox value={noteIsPrivate} onChange={setNoteIsPrivate} />
                    <Button onClick={handleAddNote} disabled={!note.trim()} size="sm" className="h-7 px-3 text-xs">
                        Add note
                    </Button>
                </div>
            </div>
        </div>
    );
}
