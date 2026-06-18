import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    Input,
    OnChanges,
    SimpleChanges,
} from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { NODE_HEIGHT } from './constants';
import { StateNode } from './types';

@Component({
    selector: 'vdr-order-process-node',
    templateUrl: './order-process-node.component.html',
    styleUrls: ['./order-process-node.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderProcessNodeComponent implements OnChanges {
    @Input() node: StateNode;
    @Input() index: number;
    @Input() active: boolean;
    active$ = new BehaviorSubject<boolean>(false);
    activeTarget$ = new BehaviorSubject<boolean>(false);
    isCancellable = false;
    // We use a class field here to prevent the
    // i18n extractor from extracting a "Cancelled" key
    cancelledState = 'Cancelled';

    constructor(private elementRef: ElementRef<HTMLDivElement>) {}

    ngOnChanges(changes: SimpleChanges) {
        this.isCancellable = !!this.node.to.find(s => s.name === 'Cancelled');
        if (changes.active) {
            this.active$.next(this.active);
        }
    }

    getPos(origin: 'top' | 'bottom' = 'top'): { x: number; y: number } {
        const rect = this.elementRef.nativeElement.getBoundingClientRect();
        const nodeHeight =
            this.elementRef.nativeElement.querySelector('.node')?.getBoundingClientRect().height ?? 0;
        return {
            x: 10,
            y: this.index * NODE_HEIGHT + (origin === 'bottom' ? nodeHeight : 0),
        };
    }

    getStyle() {
        const pos = this.getPos();
        return {
            'top.px': pos.y,
            'left.px': pos.x,
        };
    }
}
