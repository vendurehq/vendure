import { Injectable } from '@angular/core';

import { BulkAction, BulkActionLocationId } from './bulk-action-types';

@Injectable({
    providedIn: 'root',
})
export class BulkActionRegistryService {
    private locationBulActionMap = new Map<BulkActionLocationId, Set<BulkAction>>();

    registerBulkAction(bulkAction: BulkAction) {
        if (!this.locationBulActionMap.has(bulkAction.location)) {
            this.locationBulActionMap.set(bulkAction.location, new Set([bulkAction]));
        } else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.locationBulActionMap.get(bulkAction.location)!.add(bulkAction);
        }
    }

    getBulkActionsForLocation(id: BulkActionLocationId): BulkAction[] {
        return [...(this.locationBulActionMap.get(id)?.values() ?? [])];
    }
}
