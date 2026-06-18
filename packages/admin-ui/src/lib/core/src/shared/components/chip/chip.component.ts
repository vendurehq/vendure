import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * @description
 * A chip component for displaying a label with an optional action icon.
 *
 * @example
 * ```HTML
 * <vdr-chip [colorFrom]="item.value"
 *           icon="close"
 *           (iconClick)="clear(item)">
 * {{ item.value }}</vdr-chip>
 * ```
 * @docsCategory components
 */
@Component({
    selector: 'vdr-chip',
    templateUrl: './chip.component.html',
    styleUrls: ['./chip.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ChipComponent {
    /**
     * @description
     * The icon should be the name of one of the available Clarity icons: https://clarity.design/foundation/icons/shapes/
     *
     */
    @Input() icon: string;
    @Input() invert = false;
    /**
     * @description
     * If set, the chip will have an auto-generated background
     * color based on the string value passed in.
     */
    @Input() colorFrom = '';
    /**
     * @description
     * The color of the chip can also be one of the standard status colors.
     */
    @Input() colorType: 'error' | 'success' | 'warning';
    @Output() iconClick = new EventEmitter<MouseEvent>();
}
