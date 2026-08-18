import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';

/**
 * @description
 * A role held by the active administrator.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export interface DashboardUserRole {
    id: string;
    code: string;
    description: string;
    /**
     * The channels this role is granted on. Note that `DashboardUserContext.roles`
     * is NOT filtered by the active channel; check this yourself if you need
     * channel-scoped role logic.
     */
    channels: Array<{ id: string }>;
}

/**
 * @description
 * A channel the active administrator can access.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export interface DashboardUserChannel {
    id: string;
    token: string;
    code: string;
    permissions: string[];
}

/**
 * @description
 * Augment this interface in your own project to get typed Administrator custom fields
 * on `DashboardUserContext.administrator.customFields`.
 *
 * @example
 * ```ts
 * declare module '@vendure/dashboard' {
 *     interface AdministratorCustomFields {
 *         isFloorStaff?: boolean;
 *     }
 * }
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AdministratorCustomFields {}

/**
 * @description
 * The active administrator.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export interface DashboardAdministrator {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    user: { id: string; identifier: string; roles: DashboardUserRole[] };
    /**
     * Administrator custom fields. Undefined until they have loaded; the framework
     * does not evaluate visibility rules before then, so rules never observe the
     * unloaded state.
     */
    customFields?: AdministratorCustomFields & Record<string, unknown>;
}

/**
 * @description
 * Describes the logged-in dashboard user. Passed to nav menu transforms and to
 * `isVisible` predicates so they can decide what this user should see.
 *
 * This controls presentation only. It is never an authorization mechanism: a user who
 * can call an operation on the Admin API can still call it regardless of what the
 * dashboard renders.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export interface DashboardUserContext {
    /** The active administrator, or undefined when logged out. */
    administrator: DashboardAdministrator | undefined;
    /**
     * Every role the administrator holds, on any channel. This is NOT scoped to
     * `activeChannel`, unlike `hasPermissions()`. To scope it yourself:
     *
     * @example
     * ```ts
     * const isSellerHere = (ctx: DashboardUserContext) =>
     *     ctx.roles.some(
     *         r => r.code === 'seller' && r.channels.some(c => c.id === ctx.activeChannel?.id),
     *     );
     * ```
     */
    roles: DashboardUserRole[];
    /** All channels the administrator can access. */
    channels: DashboardUserChannel[];
    /** The currently selected channel. */
    activeChannel: DashboardUserChannel | undefined;
    /**
     * Whether the administrator holds ANY of the given permissions on the active
     * channel. Note the OR semantics despite the plural name.
     */
    hasPermissions: (permissions: string[]) => boolean;
    /** Whether the administrator holds the SuperAdmin role. */
    isSuperAdmin: boolean;
}

export interface BuildDashboardUserContextInput {
    administrator:
        | {
              id: string;
              firstName: string;
              lastName: string;
              emailAddress: string;
              user: { id: string; identifier: string; roles: readonly DashboardUserRole[] };
          }
        | undefined;
    channels: readonly DashboardUserChannel[] | undefined;
    activeChannel: DashboardUserChannel | undefined;
    customFields: Record<string, unknown> | undefined;
    hasPermissions: (permissions: string[]) => boolean;
}

/**
 * @description
 * Assembles a {@link DashboardUserContext}. Pure, so it can be unit tested and reused
 * outside React (for example in a TanStack Router `beforeLoad`).
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export function buildDashboardUserContext(input: BuildDashboardUserContextInput): DashboardUserContext {
    const roles: DashboardUserRole[] = input.administrator
        ? input.administrator.user.roles.map(r => ({
              id: r.id,
              code: r.code,
              description: r.description,
              channels: r.channels.map(c => ({ id: c.id })),
          }))
        : [];

    const administrator: DashboardAdministrator | undefined = input.administrator
        ? {
              id: input.administrator.id,
              firstName: input.administrator.firstName,
              lastName: input.administrator.lastName,
              emailAddress: input.administrator.emailAddress,
              user: {
                  id: input.administrator.user.id,
                  identifier: input.administrator.user.identifier,
                  roles,
              },
              ...(input.customFields ? { customFields: input.customFields } : {}),
          }
        : undefined;

    return {
        administrator,
        roles,
        channels: input.channels ? [...input.channels] : [],
        activeChannel: input.activeChannel,
        hasPermissions: input.hasPermissions,
        isSuperAdmin: roles.some(r => r.code === SUPER_ADMIN_ROLE_CODE),
    };
}
