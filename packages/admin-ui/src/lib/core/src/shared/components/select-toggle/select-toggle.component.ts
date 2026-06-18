import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

/**
 * A simple, stateless toggle button for indicating selection.
 */
@Component({
    selector: 'vdr-select-toggle',
    templateUrl: './select-toggle.component.html',
    styleUrls: ['./select-toggle.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class SelectToggleComponent {
    @Input() size: 'small' | 'large' = 'large';
    @Input() selected = false;
    @Input() hiddenWhenOff = false;
    @Input() disabled = false;
    @Input() label: string | undefined;
    @Output() selectedChange = new EventEmitter<boolean>();
}
