import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import {
    CancelOrderInput,
    DataService,
    Dialog,
    OrderProcessState,
    ServerConfigService,
} from '@vendure/admin-ui/core';
import { Observable } from 'rxjs';

@Component({
    selector: 'vdr-order-process-graph-dialog',
    templateUrl: './order-process-graph-dialog.component.html',
    styleUrls: ['./order-process-graph-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderProcessGraphDialogComponent implements OnInit, Dialog<void> {
    activeState: string;
    states: OrderProcessState[] = [];
    constructor(private serverConfigService: ServerConfigService) {}

    ngOnInit(): void {
        this.states = this.serverConfigService.getOrderProcessStates();
    }

    resolveWith: (result: void | undefined) => void;
}
