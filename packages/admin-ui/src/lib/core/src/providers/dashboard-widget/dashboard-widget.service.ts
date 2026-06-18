import { Injectable } from '@angular/core';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { Permission } from '../../common/generated-types';

import {
    DashboardWidgetConfig,
    DashboardWidgetWidth,
    WidgetLayout,
    WidgetLayoutDefinition,
} from './dashboard-widget-types';

/**
 * Responsible for registering dashboard widget components and querying for layouts.
 */
@Injectable({
    providedIn: 'root',
})
export class DashboardWidgetService {
    private registry = new Map<string, DashboardWidgetConfig>();
    private layoutDef: WidgetLayoutDefinition = [];

    registerWidget(id: string, config: DashboardWidgetConfig) {
        if (this.registry.has(id)) {
            throw new Error(`A dashboard widget with the id "${id}" already exists`);
        }

        this.registry.set(id, config);
    }

    getAvailableWidgets(
        currentUserPermissions: Permission[],
    ): Array<{ id: string; config: DashboardWidgetConfig }> {
        const hasAllPermissions = (requiredPerms: string[], userPerms: string[]): boolean =>
            requiredPerms.every(p => userPerms.includes(p));

        return [...this.registry.entries()]
            .filter(
                ([id, config]) =>
                    !config.requiresPermissions ||
                    hasAllPermissions(config.requiresPermissions, currentUserPermissions),
            )
            .map(([id, config]) => ({ id, config }));
    }

    getWidgetById(id: string) {
        return this.registry.get(id);
    }

    setDefaultLayout(layout: WidgetLayoutDefinition) {
        this.layoutDef = layout;
    }

    getDefaultLayout(): WidgetLayoutDefinition {
        return this.layoutDef;
    }

    getWidgetLayout(layoutDef?: WidgetLayoutDefinition): WidgetLayout {
        const intermediateLayout = (layoutDef || this.layoutDef)
            .map(({ id, width }) => {
                const config = this.registry.get(id);
                if (!config) {
                    return this.idNotFound(id);
                }
                return { id, config, width: this.getValidWidth(id, config, width) };
            })
            .filter(notNullOrUndefined);

        return this.buildLayout(intermediateLayout);
    }

    private idNotFound(id: string): undefined {
        // eslint-disable-next-line no-console
        console.error(
            `No dashboard widget was found with the id "${id}"\nAvailable ids: ${[...this.registry.keys()]
                .map(_id => `"${_id}"`)
                .join(', ')}`,
        );
        return;
    }

    private getValidWidth(
        id: string,
        config: DashboardWidgetConfig,
        targetWidth: DashboardWidgetWidth,
    ): DashboardWidgetWidth {
        let adjustedWidth = targetWidth;
        const supportedWidths = config.supportedWidths?.length
            ? config.supportedWidths
            : ([3, 4, 6, 8, 12] as DashboardWidgetWidth[]);
        if (!supportedWidths.includes(targetWidth)) {
            // Fall back to the largest supported width
            const sortedWidths = supportedWidths.sort((a, b) => a - b);
            const fallbackWidth = supportedWidths[sortedWidths.length - 1];
            // eslint-disable-next-line no-console
            console.error(
                `The "${id}" widget does not support the specified width (${targetWidth}).\nSupported widths are: [${sortedWidths.join(
                    ', ',
                )}].\nUsing (${fallbackWidth}) instead.`,
            );
            adjustedWidth = fallbackWidth;
        }
        return adjustedWidth;
    }

    private buildLayout(intermediateLayout: WidgetLayout[number]): WidgetLayout {
        const layout: WidgetLayout = [];
        let row: WidgetLayout[number] = [];
        for (const { id, config, width } of intermediateLayout) {
            const rowSize = row.reduce((size, c) => size + c.width, 0);
            if (12 < rowSize + width) {
                layout.push(row);
                row = [];
            }
            row.push({ id, config, width });
        }
        layout.push(row);
        return layout;
    }
}
