import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
    selector: 'vdr-help-tooltip',
    templateUrl: './help-tooltip.component.html',
    styleUrls: ['./help-tooltip.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class HelpTooltipComponent {
    @Input() content: string;
    @Input() position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'right' | 'left';
}
