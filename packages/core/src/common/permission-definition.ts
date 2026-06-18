import { Permission } from '@vendure/common/lib/generated-types';

/**
 * @description
 * Configures a {@link PermissionDefinition}
 *
 * @docsCategory auth
 * @docsPage PermissionDefinition
 */
export interface PermissionDefinitionConfig {
    /**
     * @description
     * The name of the permission. By convention this should be
     * UpperCamelCased.
     */
    name: string;
    /**
     * @description
     * A description of the permission.
     */
    description?: string;
    /**
     * @description
     * Whether this permission can be assigned to a Role. In general this
     * should be left as the default `true` except in special cases.
     *
     * @default true
     */
    assignable?: boolean;
    /**
     * @description
     * Internal permissions are not exposed via the API and are reserved for
     * special use-cases such at the `Owner` or `Public` permissions.
     *
     * @default false
     */
    internal?: boolean;
}

/**
 * @description
 * Permission metadata used internally in generating the GraphQL `Permissions` enum.
 *
 * @internal
 */
export type PermissionMetadata = Required<PermissionDefinitionConfig>;

/**
 * @description
 * Defines a new Permission with which to control access to GraphQL resolvers & REST controllers.
 * Used in conjunction with the {@link Allow} decorator (see example below).
 *
 * **Note:** To define CRUD permissions, use the {@link CrudPermissionDefinition}.
 *
 * @example
 * ```ts
 * export const sync = new PermissionDefinition({
 *   name: 'SyncInventory',
 *   description: 'Allows syncing stock levels via Admin API'
 * });
 * ```
 *
 * ```ts
 * const config: VendureConfig = {
 *   authOptions: {
 *     customPermissions: [sync],
 *   },
 * }
 * ```
 *
 * ```ts
 * \@Resolver()
 * export class ExternalSyncResolver {
 *
 *   \@Allow(sync.Permission)
 *   \@Mutation()
 *   syncStockLevels() {
 *     // ...
 *   }
 * }
 * ```
 * @docsCategory auth
 * @docsPage PermissionDefinition
 * @docsWeight 0
 */
export class PermissionDefinition {
    constructor(protected config: PermissionDefinitionConfig) {}

    /** @internal */
    getMetadata(): PermissionMetadata[] {
        const { name, description, assignable, internal } = this.config;
        return [
            {
                name,
                description: description || `Grants permissions on ${name} operations`,
                assignable: assignable ?? true,
                internal: internal ?? false,
            },
        ];
    }

    /**
     * @description
     * Returns the permission defined by this definition, for use in the
     * {@link Allow} decorator.
     */
    get Permission(): Permission {
        return this.config.name as Permission;
    }
}

/**
 * @description
 * Defines a set of CRUD Permissions for the given name, i.e. a `name` of 'Wishlist' will create
 * 4 Permissions: 'CreateWishlist', 'ReadWishlist', 'UpdateWishlist' & 'DeleteWishlist'.
 *
 * @example
 * ```ts
 * export const wishlist = new CrudPermissionDefinition('Wishlist');
 * ```
 *
 * ```ts
 * const config: VendureConfig = {
 *   authOptions: {
 *     customPermissions: [wishlist],
 *   },
 * }
 * ```
 *
 * ```ts
 * \@Resolver()
 * export class WishlistResolver {
 *
 *   \@Allow(wishlist.Create)
 *   \@Mutation()
 *   createWishlist() {
 *     // ...
 *   }
 * }
 * ```
 *
 * @docsCategory auth
 * @docsPage PermissionDefinition
 * @docsWeight 1
 */
export class CrudPermissionDefinition extends PermissionDefinition {
    constructor(
        name: string,
        private descriptionFn?: (operation: 'create' | 'read' | 'update' | 'delete') => string,
    ) {
        super({ name });
    }

    /** @internal */
    getMetadata(): PermissionMetadata[] {
        return ['Create', 'Read', 'Update', 'Delete'].map(operation => ({
            name: `${operation}${this.config.name}`,
            description:
                typeof this.descriptionFn === 'function'
                    ? this.descriptionFn(operation.toLocaleLowerCase() as any)
                    : `Grants permission to ${operation.toLocaleLowerCase()} ${this.config.name}`,
            assignable: true,
            internal: false,
        }));
    }

    /**
     * @description
     * Returns the 'Create' CRUD permission defined by this definition, for use in the
     * {@link Allow} decorator.
     */
    get Create(): Permission {
        return `Create${this.config.name}` as Permission;
    }

    /**
     * @description
     * Returns the 'Read' CRUD permission defined by this definition, for use in the
     * {@link Allow} decorator.
     */
    get Read(): Permission {
        return `Read${this.config.name}` as Permission;
    }

    /**
     * @description
     * Returns the 'Update' CRUD permission defined by this definition, for use in the
     * {@link Allow} decorator.
     */
    get Update(): Permission {
        return `Update${this.config.name}` as Permission;
    }

    /**
     * @description
     * Returns the 'Delete' CRUD permission defined by this definition, for use in the
     * {@link Allow} decorator.
     */
    get Delete(): Permission {
        return `Delete${this.config.name}` as Permission;
    }
}

/**
 * @description
 * Defines a set of Read-Write Permissions for the given name, i.e. a `name` of 'DashboardSavedViews' will create
 * 2 Permissions: 'ReadDashboardSavedViews' and 'WriteDashboardSavedViews'.
 *
 * @example
 * ```ts
 * export const dashboardSavedViews = new RwPermissionDefinition('DashboardSavedViews');
 * ```
 *
 * ```ts
 * const config: VendureConfig = {
 *   authOptions: {
 *     customPermissions: [dashboardSavedViews],
 *   },
 * }
 * ```
 *
 * ```ts
 * \@Resolver()
 * export class DashboardResolver {
 *
 *   \@Allow(dashboardSavedViews.Read)
 *   \@Query()
 *   getDashboardSavedViews() {
 *     // ...
 *   }
 *
 *   \@Allow(dashboardSavedViews.Write)
 *   \@Mutation()
 *   saveDashboardView() {
 *     // ...
 *   }
 * }
 * ```
 *
 * @docsCategory auth
 * @docsPage PermissionDefinition
 * @docsWeight 2
 * @since 3.5.0
 */
export class RwPermissionDefinition extends PermissionDefinition {
    constructor(
        name: string,
        private descriptionFn?: (operation: 'read' | 'write') => string,
    ) {
        super({ name });
    }

    /** @internal */
    getMetadata(): PermissionMetadata[] {
        return ['Read', 'Write'].map(operation => ({
            name: `${operation}${this.config.name}`,
            description:
                typeof this.descriptionFn === 'function'
                    ? this.descriptionFn(operation.toLocaleLowerCase() as any)
                    : `Grants permission to ${operation.toLocaleLowerCase()} ${this.config.name}`,
            assignable: true,
            internal: false,
        }));
    }

    /**
     * @description
     * Returns the 'Read' permission defined by this definition, for use in the
     * {@link Allow} decorator.
     */
    get Read(): Permission {
        return `Read${this.config.name}` as Permission;
    }

    /**
     * @description
     * Returns the 'Write' permission defined by this definition, for use in the
     * {@link Allow} decorator.
     */
    get Write(): Permission {
        return `Write${this.config.name}` as Permission;
    }
}
