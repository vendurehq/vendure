import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * A wrapper around an <input> element which adds a prefix and/or a suffix element.
 */
@Component({
    selector: 'vdr-affixed-input',
    templateUrl: './affixed-input.component.html',
    styleUrls: ['./affixed-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AffixedInputComponent {
    @Input() prefix: string;
    @Input() suffix: string;
}
