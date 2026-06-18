import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { OrderProcessNodeComponent } from './order-process-node.component';

@Component({
    selector: 'vdr-order-process-edge',
    templateUrl: './order-process-edge.component.html',
    styleUrls: ['./order-process-edge.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderProcessEdgeComponent implements OnInit {
    @Input() from: OrderProcessNodeComponent;
    @Input() to: OrderProcessNodeComponent;
    @Input() index: number;
    active$: Observable<boolean>;

    ngOnInit() {
        this.active$ = this.from.active$
            .asObservable()
            .pipe(tap(active => this.to.activeTarget$.next(active)));
    }

    getStyle() {
        const direction = this.from.index < this.to.index ? 'down' : 'up';
        const startPos = this.from.getPos(direction === 'down' ? 'bottom' : 'top');
        const endPos = this.to.getPos(direction === 'down' ? 'top' : 'bottom');
        const dX = Math.abs(startPos.x - endPos.x);
        const dY = Math.abs(startPos.y - endPos.y);
        const length = Math.sqrt(dX ** 2 + dY ** 2);
        return {
            'top.px': startPos.y,
            'left.px': startPos.x + (direction === 'down' ? 10 : 40) + this.index * 12,
            'height.px': length,
            'width.px': 1,
            ...(direction === 'up'
                ? {
                      transform: 'rotateZ(180deg)',
                      'transform-origin': 'top',
                  }
                : {}),
        };
    }
}
