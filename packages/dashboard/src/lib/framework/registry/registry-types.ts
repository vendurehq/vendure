import {
    BulkAction,
    DashboardActionBarItem,
    DashboardHistoryEntryComponent,
    DashboardLoginExtensions,
    DashboardPageBlockDefinition,
    DashboardToolbarItemDefinition,
    DashboardWidgetDefinition,
} from '@/vdb/framework/extension-api/types/index.js';
import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';
import { DocumentNode } from 'graphql';

import { DataDisplayComponent } from '../component-registry/component-registry.js';
import { DashboardAlertDefinition } from '../extension-api/types/alerts.js';
import { DataTableDisplayComponent } from '../extension-api/types/data-table.js';
import { NavMenuConfig } from '../nav-menu/nav-menu-extensions.js';

export interface GlobalRegistryContents {
    extensionSourceChangeCallbacks: Set<() => void>;
    registerDashboardExtensionCallbacks: Set<() => void>;
    navMenuConfig: NavMenuConfig;
    dashboardActionBarItemRegistry: Map<string, DashboardActionBarItem[]>;
    dashboardPageBlockRegistry: Map<string, DashboardPageBlockDefinition[]>;
    dashboardWidgetRegistry: Map<string, DashboardWidgetDefinition>;
    dashboardAlertRegistry: Map<string, DashboardAlertDefinition>;
    inputComponents: Map<string, DashboardFormComponent>;
    displayComponents: Map<string, DataDisplayComponent | DataTableDisplayComponent>;
    bulkActionsRegistry: Map<string, BulkAction[]>;
    listQueryDocumentRegistry: Map<string, DocumentNode[]>;
    detailQueryDocumentRegistry: Map<string, DocumentNode[]>;
    loginExtensions: DashboardLoginExtensions;
    historyEntries: Map<string, DashboardHistoryEntryComponent['component']>;
    navMenuModifiers: Array<(config: NavMenuConfig) => NavMenuConfig>;
    dashboardToolbarItemRegistry: Map<string, DashboardToolbarItemDefinition>;
}
