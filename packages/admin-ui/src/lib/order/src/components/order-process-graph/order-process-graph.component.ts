import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    HostBinding,
    Input,
    OnChanges,
    OnInit,
    QueryList,
    SimpleChanges,
    ViewChildren,
} from '@angular/core';
import { OrderProcessState } from '@vendure/admin-ui/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { NODE_HEIGHT } from './constants';
import { OrderProcessNodeComponent } from './order-process-node.component';
import { StateNode } from './types';

@Component({
    selector: 'vdr-order-process-graph',
    templateUrl: './order-process-graph.component.html',
    styleUrls: ['./order-process-graph.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderProcessGraphComponent implements OnInit, OnChanges, AfterViewInit {
    @Input() states: OrderProcessState[];
    @Input() initialState?: string;
    setActiveState$ = new BehaviorSubject<string | undefined>(undefined);
    activeState$: Observable<string | undefined>;
    nodes: StateNode[] = [];
    edges: Array<{ from: OrderProcessNodeComponent; to: OrderProcessNodeComponent; index: number }> = [];

    @ViewChildren(OrderProcessNodeComponent) nodeComponents: QueryList<OrderProcessNodeComponent>;

    constructor(private changeDetector: ChangeDetectorRef) {}

    @HostBinding('style.height.px')
    get outerHeight(): number {
        return this.nodes.length * NODE_HEIGHT;
    }

    ngOnInit() {
        this.setActiveState$.next(this.initialState);
        this.activeState$ = this.setActiveState$.pipe(debounceTime(150));
    }

    ngOnChanges(changes: SimpleChanges) {
        this.populateNodes();
    }

    ngAfterViewInit() {
        setTimeout(() => this.populateEdges());
    }

    onMouseOver(stateName: string) {
        this.setActiveState$.next(stateName);
    }

    onMouseOut() {
        this.setActiveState$.next(this.initialState);
    }

    getNodeFor(state: string): OrderProcessNodeComponent | undefined {
        if (this.nodeComponents) {
            return this.nodeComponents.find(n => n.node.name === state);
        }
    }

    private populateNodes() {
        const stateNodeMap = new Map<string, StateNode>();
        for (const state of this.states) {
            stateNodeMap.set(state.name, {
                name: state.name,
                to: [],
            });
        }

        for (const [name, stateNode] of stateNodeMap.entries()) {
            const targets = this.states.find(s => s.name === name)?.to ?? [];
            for (const target of targets) {
                const targetNode = stateNodeMap.get(target);
                if (targetNode) {
                    stateNode.to.push(targetNode);
                }
            }
        }
        this.nodes = [...stateNodeMap.values()].filter(n => n.name !== 'Cancelled');
    }

    private populateEdges() {
        for (const node of this.nodes) {
            const nodeCmp = this.getNodeFor(node.name);
            let index = 0;
            for (const to of node.to) {
                const toCmp = this.getNodeFor(to.name);
                if (nodeCmp && toCmp && nodeCmp !== toCmp) {
                    this.edges.push({
                        to: toCmp,
                        from: nodeCmp,
                        index,
                    });
                    index++;
                }
            }
        }
        this.edges = [...this.edges];
        this.changeDetector.markForCheck();
    }
}
