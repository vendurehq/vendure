import { DashboardRefundDestinationDefinition } from '@/vdb/framework/extension-api/types/index.js';

import { globalRegistry } from '../../registry/global-registry.js';

export function registerRefundDestinationExtensions(
    refundDestinations: DashboardRefundDestinationDefinition[] = [],
) {
    if (refundDestinations.length === 0) {
        return;
    }
    globalRegistry.set('refundDestinations', destinationMap => {
        for (const destination of refundDestinations) {
            if (destinationMap.has(destination.code)) {
                // eslint-disable-next-line no-console
                console.warn(
                    `The refund destination "${destination.code}" already has a definition registered. ` +
                        `The existing definition will be replaced.`,
                );
            }
            destinationMap.set(destination.code, destination);
        }
        return destinationMap;
    });
}
