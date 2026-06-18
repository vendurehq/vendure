import { inject, provideAppInitializer } from '@angular/core';
import { HistoryEntryConfig } from '../providers/custom-history-entry-component/history-entry-component-types';
import { HistoryEntryComponentService } from '../providers/custom-history-entry-component/history-entry-component.service';

/**
 * @description
 * Registers a {@link HistoryEntryComponent} for displaying history entries in the Order/Customer
 * history timeline.
 *
 * @example
 * ```ts
 * import { Component } from '\@angular/core';
 * import {
 *     CustomerFragment,
 *     CustomerHistoryEntryComponent,
 *     registerHistoryEntryComponent,
 *     SharedModule,
 *     TimelineDisplayType,
 *     TimelineHistoryEntry,
 * } from '\@vendure/admin-ui/core';
 *
 * \@Component({
 *     selector: 'tax-id-verification-component',
 *     template: `
 *         <div *ngIf="entry.data.valid">
 *           Tax ID <strong>{{ entry.data.taxId }}</strong> was verified
 *           <vdr-history-entry-detail *ngIf="entry.data">
 *             <vdr-object-tree [value]="entry.data"></vdr-object-tree>
 *           </vdr-history-entry-detail>
 *         </div>
 *         <div *ngIf="entry.data.valid">Tax ID {{ entry.data.taxId }} could not be verified</div>
 *     `,
 *     standalone: true,
 *     imports: [SharedModule],
 * })
 * class TaxIdHistoryEntryComponent implements CustomerHistoryEntryComponent {
 *     entry: TimelineHistoryEntry;
 *     customer: CustomerFragment;
 *
 *     getDisplayType(entry: TimelineHistoryEntry): TimelineDisplayType {
 *         return entry.data.valid ? 'success' : 'error';
 *     }
 *
 *     getName(entry: TimelineHistoryEntry): string {
 *         return 'Tax ID Verification Plugin';
 *     }
 *
 *     isFeatured(entry: TimelineHistoryEntry): boolean {
 *         return true;
 *     }
 *
 *     getIconShape(entry: TimelineHistoryEntry) {
 *         return entry.data.valid ? 'check-circle' : 'exclamation-circle';
 *     }
 * }
 *
 * export default [
 *     registerHistoryEntryComponent({
 *         type: 'CUSTOMER_TAX_ID_VERIFICATION',
 *         component: TaxIdHistoryEntryComponent,
 *     }),
 * ];
 * ```
 *
 * @since 1.9.0
 * @docsCategory custom-history-entry-components
 */
export function registerHistoryEntryComponent(config: HistoryEntryConfig) {
    return provideAppInitializer(() => {
        const initializerFn = ((customHistoryEntryComponentService: HistoryEntryComponentService) => () => {
            customHistoryEntryComponentService.registerComponent(config);
        })(inject(HistoryEntryComponentService));
        return initializerFn();
    });
}
