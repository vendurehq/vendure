import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';
import React from 'react';
import { getDisplayComponent } from '../extension-api/display-component-extensions.js';
import { getInputComponent } from '../extension-api/input-component-extensions.js';

export type DataDisplayComponent<T extends Record<string, any> = Record<string, any>> = React.ComponentType<T & { value: any}>;

// Component registry hook that uses the global registry
export function useComponentRegistry() {
    return {
        getDisplayComponent: (id: string): DataDisplayComponent | undefined => {
            return getDisplayComponent(id);
        },
        getInputComponent: (id: string): DashboardFormComponent | undefined => {
            return getInputComponent(id);
        },
    };
}
