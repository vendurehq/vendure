import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FulfillmentFragment, OrderDetailFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-fulfillment-card',
    templateUrl: './fulfillment-card.component.html',
    styleUrls: ['./fulfillment-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class FulfillmentCardComponent {
    @Input() fulfillment: FulfillmentFragment | undefined;
    @Input() order: OrderDetailFragment;
    @Output() transitionState = new EventEmitter<string>();

    nextSuggestedState(): string | undefined {
        if (!this.fulfillment) {
            return;
        }
        const { nextStates } = this.fulfillment;
        const namedStateOrDefault = (targetState: string) =>
            nextStates.includes(targetState) ? targetState : nextStates[0];
        switch (this.fulfillment?.state) {
            case 'Pending':
                return namedStateOrDefault('Shipped');
            case 'Shipped':
                return namedStateOrDefault('Delivered');
            default:
                return nextStates.find(s => s !== 'Cancelled');
        }
    }

    nextOtherStates(): string[] {
        if (!this.fulfillment) {
            return [];
        }
        const suggested = this.nextSuggestedState();
        return this.fulfillment.nextStates.filter(s => s !== suggested);
    }
}
