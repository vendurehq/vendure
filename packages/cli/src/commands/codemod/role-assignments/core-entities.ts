import { Type } from 'ts-morph';

/**
 * The relations removed in v4, by entity: a User no longer has Roles and a Role no longer
 * has Channels. Both are replaced by the RoleAssignment entity, one row per
 * (user, role, channel).
 */
export const REMOVED_RELATIONS: Record<string, string[]> = {
    User: ['roles'],
    Role: ['channels'],
};

/**
 * The core relations a relation path can follow to reach a removed relation, by entity.
 * `user.roles` on an Administrator walks `user` to User, then hits the removed `roles`.
 * A segment not listed here ends the walk, and the path is left as it is.
 */
const RELATION_TARGETS: Record<string, Record<string, string>> = {
    Administrator: { user: 'User' },
    ApiKey: { user: 'User', owner: 'User' },
    AuthenticatedSession: { user: 'User' },
    Customer: { user: 'User' },
    Order: { customer: 'Customer' },
    RoleAssignment: { user: 'User', role: 'Role' },
    User: { roles: 'Role' },
    Role: {},
};

export const Messages = {
    UserRoles:
        'User.roles was removed in v4. Read the Roles of a User with ' +
        'RoleAssignmentService.resolveUserRoles(ctx, userId); grant or revoke them per Channel with ' +
        'RoleAssignmentService.assign() / remove().',
    RoleChannels:
        'Role.channels was removed in v4: a Role is no longer bound to Channels. Find where a Role ' +
        'is assigned through the RoleAssignment entity ({ where: { roleId } }); grant it per Channel ' +
        'with RoleAssignmentService.assign().',
    RemovedJoin:
        'This joins a role table removed in v4 (user_roles_role or role_channels_channel). ' +
        'Join the RoleAssignment entity instead.',
    UnresolvedRelation:
        'If this loads User.roles or Role.channels, remove it: both relations were removed in v4 ' +
        'and TypeORM throws on unknown relations.',
    UnresolvedJoin:
        'If this joins User.roles or Role.channels, join the RoleAssignment entity instead: both ' +
        'relations were removed in v4.',
    RoleChannelIds:
        'channelIds was removed from CreateRoleInput and UpdateRoleInput in v4: a Role is no longer ' +
        'bound to Channels. Grant it to a User per Channel with RoleAssignmentService.assign().',
    GetChannelsForRole:
        'RoleService.getChannelsForRole() was removed in v4: a Role is no longer bound to Channels. ' +
        'Find where a Role is assigned through the RoleAssignment entity ({ where: { roleId } }).',
    GetCustomerRole:
        'RoleService.getCustomerRole() was removed in v4: Customer permissions come from the ' +
        "Customer's Channel memberships, so there is no Customer Role to read or grant.",
    AssignRoleToChannel:
        'RoleService.assignRoleToChannel() was removed in v4: a Role is no longer bound to Channels. ' +
        'Grant it to a User per Channel with RoleAssignmentService.assign().',
    CreateApiKeyUser:
        'UserService.createApiKeyUser() no longer takes Roles in v4: call createApiKeyUser(ctx, identifier), ' +
        'then grant the Roles per Channel with RoleAssignmentService.assign().',
    RoleChannelAware:
        'Role is no longer ChannelAware in v4 and cannot be assigned to Channels. Grant it to a User ' +
        'per Channel with RoleAssignmentService.assign().',
};

/**
 * Public service methods removed or changed in v4, by service and method name.
 */
export const REMOVED_METHODS: Record<string, Record<string, string>> = {
    RoleService: {
        getChannelsForRole: Messages.GetChannelsForRole,
        getCustomerRole: Messages.GetCustomerRole,
        assignRoleToChannel: Messages.AssignRoleToChannel,
    },
};

export function messageForRemovedRelation(entity: string): string {
    return entity === 'User' ? Messages.UserRoles : Messages.RoleChannels;
}

export function isRemovedRelation(entity: string, relation: string): boolean {
    return REMOVED_RELATIONS[entity]?.includes(relation) ?? false;
}

export function getRelationTarget(entity: string, relation: string): string | undefined {
    return RELATION_TARGETS[entity]?.[relation];
}

export type RelationPathResult =
    | { kind: 'removed'; entity: string }
    | { kind: 'kept' }
    | { kind: 'unresolved' };

/**
 * Walks a dotted relation path such as `user.roles.channels` from the given root entity.
 * Returns `removed` when the path passes through a removed relation, `kept` when it does not,
 * and `unresolved` when there is no root entity to start from.
 */
export function walkRelationPath(rootEntity: string | undefined, relationPath: string): RelationPathResult {
    if (!rootEntity) {
        return { kind: 'unresolved' };
    }
    let entity: string | undefined = rootEntity;
    for (const segment of relationPath.split('.')) {
        if (!entity) {
            return { kind: 'kept' };
        }
        if (isRemovedRelation(entity, segment)) {
            return { kind: 'removed', entity };
        }
        entity = getRelationTarget(entity, segment);
    }
    return { kind: 'kept' };
}

const VENDURE_CORE_PATH = /[\\/](@vendure[\\/]core|packages[\\/]core[\\/]src)[\\/]/;

/**
 * Returns the name of the class or type if it is declared in `@vendure/core`. A user-defined
 * class that happens to be called `User` is not matched.
 */
export function getCoreSymbolName(type: Type): string | undefined {
    const nonNullable = type.getNonNullableType();
    const symbol = nonNullable.getSymbol() ?? nonNullable.getAliasSymbol();
    if (!symbol) {
        return undefined;
    }
    const declaredInCore = symbol
        .getDeclarations()
        .some(declaration => VENDURE_CORE_PATH.test(declaration.getSourceFile().getFilePath()));
    return declaredInCore ? symbol.getName() : undefined;
}

/**
 * Returns the entity name if the type is one of the core entities the codemod knows about.
 */
export function getCoreEntityName(type: Type): string | undefined {
    const name = getCoreSymbolName(type);
    return name && name in RELATION_TARGETS ? name : undefined;
}

/**
 * Finds the core entity a generic type is about, such as `User` in `FindOneOptions<User>`,
 * `DeepPartial<User>` or `RelationPaths<User>`, by searching the type, its type arguments
 * and its union members a few levels deep.
 */
export function findCoreEntityInType(type: Type, depth = 0): string | undefined {
    if (depth > 3) {
        return undefined;
    }
    const direct = getCoreEntityName(type);
    if (direct) {
        return direct;
    }
    const nested = [
        ...type.getTypeArguments(),
        ...type.getAliasTypeArguments(),
        ...(type.isUnion() ? type.getUnionTypes() : []),
    ];
    for (const candidate of nested) {
        const found = findCoreEntityInType(candidate, depth + 1);
        if (found) {
            return found;
        }
    }
    return undefined;
}
