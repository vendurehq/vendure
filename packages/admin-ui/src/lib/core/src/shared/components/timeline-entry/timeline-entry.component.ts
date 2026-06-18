import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    HostBinding,
    Input,
    OnInit,
    Output,
} from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';

export type TimelineDisplayType = 'success' | 'error' | 'warning' | 'default' | 'muted';

@Component({
    selector: 'vdr-timeline-entry',
    templateUrl: './timeline-entry.component.html',
    styleUrls: ['./timeline-entry.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class TimelineEntryComponent {
    @Input() displayType: TimelineDisplayType;
    @Input() createdAt: string;
    @Input() name: string;
    @Input() featured: boolean;
    @Input() iconShape?: string | [string, string];
    @Input() isFirst?: boolean;
    @Input() isLast?: boolean;
    @HostBinding('class.collapsed')
    @Input()
    collapsed = false;
    @Output() expandClick = new EventEmitter();

    get timelineTitle(): string {
        return this.collapsed ? _('common.expand-entries') : _('common.collapse-entries');
    }

    getIconShape() {
        if (this.iconShape) {
            return typeof this.iconShape === 'string' ? this.iconShape : this.iconShape[0];
        }
    }

    getIconClass() {
        if (this.iconShape) {
            return typeof this.iconShape === 'string' ? '' : this.iconShape[1];
        }
    }
}
