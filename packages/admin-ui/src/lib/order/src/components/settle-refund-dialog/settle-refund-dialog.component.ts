import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Dialog, OrderDetailFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-settle-refund-dialog',
    templateUrl: './settle-refund-dialog.component.html',
    styleUrls: ['./settle-refund-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SettleRefundDialogComponent implements Dialog<string> {
    resolveWith: (result?: string) => void;
    transactionId = '';
    refund: NonNullable<OrderDetailFragment['payments']>[number]['refunds'][number];

    submit() {
        this.resolveWith(this.transactionId);
    }

    cancel() {
        this.resolveWith();
    }
}
