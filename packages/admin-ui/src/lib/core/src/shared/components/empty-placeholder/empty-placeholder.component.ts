import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
    selector: 'vdr-empty-placeholder',
    templateUrl: './empty-placeholder.component.html',
    styleUrls: ['./empty-placeholder.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class EmptyPlaceholderComponent {
    @Input() emptyStateLabel: string;
}
