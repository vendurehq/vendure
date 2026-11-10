import { Node, SourceFile, SyntaxKind, Type } from 'ts-morph';

import {
    getCoreEntityName,
    getCoreSymbolName,
    isRemovedRelation,
    messageForRemovedRelation,
    Messages,
    REMOVED_METHODS,
} from '../core-entities';
import { FlagCollector } from '../flags';

const JOIN_METHOD = /^(left|inner)Join(AndSelect|AndMapOne|AndMapMany)?$/;
const REMOVED_TABLE = /user_roles_role|role_channels_channel/;
const ROLE_INPUT_TYPES = new Set(['CreateRoleInput', 'UpdateRoleInput']);
/** Types whose object literals write entity fields, such as `new User({ ... })`. */
const PARTIAL_TYPES = new Set(['DeepPartial', 'Partial']);

/**
 * Flags code that uses `User.roles`, `Role.channels` or the role APIs removed with them, where
 * the replacement depends on what the code means and cannot be written for it:
 *
 * - reads and writes such as `user.roles`, `role.channels = [...]` and `const { roles } = user`
 * - `roles` / `channels` in object literals that build a User or Role
 * - `channelIds` in a `CreateRoleInput` / `UpdateRoleInput`
 * - query builder joins on `roles`, or on `channels` from a role alias
 * - raw SQL naming `user_roles_role` or `role_channels_channel`
 * - calls to removed `RoleService` methods, the old `UserService.createApiKeyUser()` signature,
 *   and `ChannelService.assignToChannels()` / `removeFromChannels()` on Role
 *
 * Only types declared in `@vendure/core` are matched, so a project's own `User` class is left alone.
 */
export function flagRemovedUsages(sourceFile: SourceFile, flags: FlagCollector) {
    for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const entity = getCoreEntityName(access.getExpression().getType());
        if (entity && isRemovedRelation(entity, access.getName())) {
            flags.add(access, messageForRemovedRelation(entity));
        }
    }

    for (const pattern of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectBindingPattern)) {
        const entity = getCoreEntityName(pattern.getType());
        if (!entity) {
            continue;
        }
        for (const element of pattern.getElements()) {
            const key = element.getPropertyNameNode()?.getText() ?? element.getName();
            if (isRemovedRelation(entity, key)) {
                flags.add(element, messageForRemovedRelation(entity));
            }
        }
    }

    for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
        const type = object.getContextualType()?.getNonNullableType();
        if (!type) {
            continue;
        }
        const entity = getWrittenEntity(type);
        const isRoleInput = ROLE_INPUT_TYPES.has(
            (type.getAliasSymbol() ?? type.getSymbol())?.getName() ?? '',
        );
        for (const property of object.getProperties()) {
            if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
                continue;
            }
            const name = property.getName();
            if (entity && isRemovedRelation(entity, name)) {
                flags.add(property, messageForRemovedRelation(entity));
            } else if (isRoleInput && name === 'channelIds') {
                flags.add(property, Messages.RoleChannelIds);
            }
        }
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (Node.isPropertyAccessExpression(callee)) {
            const message = getRemovedCallMessage(
                getCoreSymbolName(callee.getExpression().getType()),
                callee.getName(),
                call.getArguments(),
            );
            if (message) {
                flags.add(call, message);
            }
        }
    }

    for (const literal of [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression),
    ]) {
        if (REMOVED_TABLE.test(literal.getText())) {
            flags.add(literal, Messages.RemovedJoin);
        }
    }
}

function getRemovedCallMessage(
    service: string | undefined,
    method: string,
    args: Node[],
): string | undefined {
    if (service && REMOVED_METHODS[service]?.[method]) {
        return REMOVED_METHODS[service][method];
    }
    if (service === 'UserService' && method === 'createApiKeyUser' && args.length === 3) {
        return Messages.CreateApiKeyUser;
    }
    if (
        service === 'ChannelService' &&
        (method === 'assignToChannels' || method === 'removeFromChannels') &&
        args[1] &&
        getCoreEntityName(args[1].getType()) === 'Role'
    ) {
        return Messages.RoleChannelAware;
    }
    if (JOIN_METHOD.test(method) && args[0] && Node.isStringLiteral(args[0])) {
        const [alias, relation] = args[0].getLiteralText().split('.');
        if (relation === 'roles' || (relation === 'channels' && /role/i.test(alias))) {
            return Messages.UnresolvedJoin;
        }
    }
    return undefined;
}

function getWrittenEntity(type: Type): string | undefined {
    const direct = getCoreEntityName(type);
    if (direct) {
        return direct;
    }
    const alias = type.getAliasSymbol()?.getName();
    const [argument] = type.getAliasTypeArguments();
    return alias && PARTIAL_TYPES.has(alias) && argument ? getCoreEntityName(argument) : undefined;
}
