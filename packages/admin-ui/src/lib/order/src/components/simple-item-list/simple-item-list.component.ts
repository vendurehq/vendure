import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
    selector: 'vdr-simple-item-list',
    templateUrl: './simple-item-list.component.html',
    styleUrls: ['./simple-item-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SimpleItemListComponent {
    @Input() items: Array<{ name: string; quantity?: number }>;
}
