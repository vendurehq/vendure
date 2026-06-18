import { LocalizedString, Permission } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';

/**
 * @description
 * A function that determines how a settings store entry should be scoped.
 * Returns a string that will be used as the scope key for storage isolation.
 *
 * @example
 * ```ts
 * // User-specific scoping
 * const userScope: SettingsStoreScopeFunction = ({ ctx }) => ctx.activeUserId || '';
 *
 * // Channel-specific scoping
 * const channelScope: SettingsStoreScopeFunction = ({ ctx }) => ctx.channelId || '';
 *
 * // User and channel scoping
 * const userAndChannelScope: SettingsStoreScopeFunction = ({ ctx }) =>
 *   `${ctx.activeUserId || ''}:${ctx.channelId || ''}`;
 * ```
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export type SettingsStoreScopeFunction = (params: {
    key: string;
    value?: any;
    ctx: RequestContext;
}) => string;

/**
 * @description
 * Configuration for a settings store field, defining how it should be stored,
 * scoped, validated, and accessed.
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export interface SettingsStoreFieldConfig {
    /**
     * @description
     * The name of the field. This will be combined with the namespace
     * to create the full key (e.g., 'dashboard.theme').
     */
    name: string;

    /**
     * @description
     * Function that determines how this field should be scoped.
     * Defaults to global scoping (no isolation).
     */
    scope?: SettingsStoreScopeFunction;

    /**
     * @description
     * Whether this field is readonly via the GraphQL API.
     * Readonly fields can still be modified programmatically via a service.
     * @default false
     */
    readonly?: boolean;

    /**
     * @description
     * Permissions required to access this field. If not specified,
     * basic authentication is required for admin API access.
     *
     * Can be either:
     * - A single permission or array of permissions (applies to both read and write)
     * - An object with `read` and `write` properties for granular control
     *
     * @example
     * ```ts
     * // Single permission for both read and write
     * requiresPermission: Permission.UpdateSettings
     *
     * // Separate read and write permissions
     * requiresPermission: {
     *   read: Permission.ReadSettings,
     *   write: Permission.UpdateSettings
     * }
     *
     * // Using custom RwPermissionDefinition
     * requiresPermission: {
     *   read: dashboardSavedViews.Read,
     *   write: dashboardSavedViews.Write
     * }
     * ```
     * @since 3.5.0 - Added support for object with read/write properties
     */
    requiresPermission?:
        | Array<Permission | string>
        | Permission
        | string
        | {
              read?: Array<Permission | string> | Permission | string;
              write?: Array<Permission | string> | Permission | string;
          };

    /**
     * @description
     * Custom validation function for field values.
     */
    validate?: (
        value: any,
        injector: Injector,
        ctx: RequestContext,
    ) => string | LocalizedString[] | void | Promise<string | LocalizedString[] | void>;
}

/**
 * @description
 * Configuration for registering a namespace of settings store fields.
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export interface SettingsStoreRegistration {
    /**
     * @description
     * The namespace for these fields (e.g., 'dashboard', 'payment').
     * Field names will be prefixed with this namespace.
     */
    namespace: string;

    /**
     * @description
     * Array of field configurations for this namespace.
     */
    fields: SettingsStoreFieldConfig[];
}

/**
 * @description
 * This is how SettingsStoreFields are defined in the {@link VendureConfig} object.
 *
 * @since 3.4.0
 * @docsCategory configuration
 */
export type SettingsStoreFields = {
    [namespace: string]: SettingsStoreFieldConfig[];
};

/**
 * @description
 * Pre-built scope functions for common scoping patterns.
 *
 * @example
 * ```ts
 * const config: VendureConfig = {
 *   settingsStoreFields: {
 *     dashboard: [
 *       {
 *         name: 'theme',
 *         scope: SettingsStoreScopes.user, // User-specific
 *       },
 *       {
 *         name: 'currency',
 *         scope: SettingsStoreScopes.channel, // Channel-specific
 *       },
 *       {
 *         name: 'tableFilters',
 *         scope: SettingsStoreScopes.userAndChannel, // User-specific per channel
 *       }
 *     ]
 *   }
 * };
 * ```
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export const SettingsStoreScopes = {
    /**
     * @description
     * Global scoping - no isolation, single value for all users and channels.
     */
    global: (): string => '',

    /**
     * @description
     * User-specific scoping - separate values per user.
     */
    user: ({ ctx }: { ctx: RequestContext }): string => `user:${ctx.activeUserId || 'unknown'}`,

    /**
     * @description
     * Channel-specific scoping - separate values per channel.
     */
    channel: ({ ctx }: { ctx: RequestContext }): string => `channel:${ctx.channelId || 'unknown'}`,

    /**
     * @description
     * User and channel specific scoping - separate values per user per channel.
     */
    userAndChannel: ({ ctx }: { ctx: RequestContext }): string =>
        `user:${ctx.activeUserId || ''}:channel:${ctx.channelId || ''}`,
};

/**
 * @description
 * Result type for settings store set operations, providing detailed feedback
 * about the success or failure of each operation.
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export interface SetSettingsStoreValueResult {
    /**
     * @description
     * The key that was attempted to be set.
     */
    key: string;

    /**
     * @description
     * Whether the set operation was successful.
     */
    result: boolean;

    /**
     * @description
     * Error message if the operation failed, null if successful.
     */
    error?: string;
}

/**
 * @description
 * Represents an orphaned settings store entry that no longer has a corresponding
 * field definition in the configuration.
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export interface OrphanedSettingsStoreEntry {
    /**
     * @description
     * The orphaned key.
     */
    key: string;

    /**
     * @description
     * The scope of the orphaned entry.
     */
    scope: string;

    /**
     * @description
     * When the entry was last updated.
     */
    updatedAt: Date;

    /**
     * @description
     * Preview of the stored value (truncated for large values).
     */
    valuePreview: string;
}

/**
 * @description
 * Options for cleaning up orphaned settings store entries.
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export interface CleanupOrphanedSettingsStoreEntriesOptions {
    /**
     * @description
     * If true, perform a dry run without actually deleting entries.
     * @default false
     */
    dryRun?: boolean;

    /**
     * @description
     * Only delete entries older than this duration.
     * Examples: '30d', '7d', '1h', '30m'
     * @default '7d'
     */
    olderThan?: string;

    /**
     * @description
     * Maximum number of entries to delete in a single operation.
     * @default 1000
     */
    maxDeleteCount?: number;

    /**
     * @description
     * Batch size for deletion operations.
     * @default 100
     */
    batchSize?: number;
}

/**
 * @description
 * Result of a cleanup operation for orphaned settings store entries.
 *
 * @docsCategory SettingsStore
 * @since 3.4.0
 */
export interface CleanupOrphanedSettingsStoreEntriesResult {
    /**
     * @description
     * Number of entries that were (or would be) deleted.
     */
    deletedCount: number;

    /**
     * @description
     * Whether this was a dry run.
     */
    dryRun: boolean;

    /**
     * @description
     * Sample of deleted entries (for logging/audit purposes).
     */
    deletedEntries: OrphanedSettingsStoreEntry[];
}
