import { useState } from 'react';

export function useHistoryNoteEditor() {
    const [noteEditorOpen, setNoteEditorOpen] = useState(false);
    const [noteState, setNoteState] = useState<{
        noteId: string;
        note: string;
        isPrivate: boolean;
    }>({
        noteId: '',
        note: '',
        isPrivate: true,
    });

    const handleEditNote = (noteId: string, note: string, isPrivate: boolean) => {
        setNoteState({ noteId, note, isPrivate });
        setNoteEditorOpen(true);
    };

    return {
        noteEditorOpen,
        setNoteEditorOpen,
        noteState,
        handleEditNote,
    };
}
