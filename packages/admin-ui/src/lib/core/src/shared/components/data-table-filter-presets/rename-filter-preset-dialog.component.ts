import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Dialog } from '../../../providers/modal/modal.types';

@Component({
    selector: 'vdr-rename-filter-preset-dialog',
    templateUrl: './rename-filter-preset-dialog.component.html',
    styleUrls: ['./rename-filter-preset-dialog.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RenameFilterPresetDialogComponent implements Dialog<string> {
    name: string;
    resolveWith: (result?: string) => void;

    rename() {
        this.resolveWith(this.name);
    }
}
