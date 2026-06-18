import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';

import { Dialog } from '../../../providers/modal/modal.types';

@Component({
    selector: 'vdr-edit-note-dialog',
    templateUrl: './edit-note-dialog.component.html',
    styleUrls: ['./edit-note-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class EditNoteDialogComponent implements Dialog<{ note: string; isPrivate?: boolean }> {
    displayPrivacyControls = true;
    noteIsPrivate = true;
    note = '';
    resolveWith: (result?: { note: string; isPrivate?: boolean }) => void;

    confirm() {
        this.resolveWith({
            note: this.note,
            isPrivate: this.noteIsPrivate,
        });
    }

    cancel() {
        this.resolveWith();
    }
}
