import { CreateRoleInput, UpdateRoleInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Role } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type RoleInputTypes = CreateRoleInput | UpdateRoleInput | ID;

/**
 * @description
 * This event is fired whenever one {@link Role} is added, updated or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class RoleEvent extends VendureEntityEvent<Role, RoleInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: Role,
        type: 'created' | 'updated' | 'deleted',
        input?: RoleInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
