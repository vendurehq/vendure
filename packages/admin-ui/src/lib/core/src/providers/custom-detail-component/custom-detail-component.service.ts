import { Injectable } from '@angular/core';

import { CustomDetailComponentConfig } from './custom-detail-component-types';

@Injectable({
    providedIn: 'root',
})
export class CustomDetailComponentService {
    private customDetailComponents = new Map<string, CustomDetailComponentConfig[]>();

    registerCustomDetailComponent(config: CustomDetailComponentConfig) {
        if (this.customDetailComponents.has(config.locationId)) {
            this.customDetailComponents.get(config.locationId)?.push(config);
        } else {
            this.customDetailComponents.set(config.locationId, [config]);
        }
    }

    getCustomDetailComponentsFor(locationId: string): CustomDetailComponentConfig[] {
        return this.customDetailComponents.get(locationId) ?? [];
    }
}
