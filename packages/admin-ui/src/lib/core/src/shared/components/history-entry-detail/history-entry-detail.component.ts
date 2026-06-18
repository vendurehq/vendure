import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'vdr-history-entry-detail',
    templateUrl: './history-entry-detail.component.html',
    styleUrls: ['./history-entry-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class HistoryEntryDetailComponent {}
