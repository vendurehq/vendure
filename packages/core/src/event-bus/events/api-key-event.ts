import { CreateApiKeyInput, UpdateApiKeyInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type ApiKeyInputTypes = CreateApiKeyInput | UpdateApiKeyInput | ID;

/**
 * @description
 * This event is fired whenever a {@link ApiKey} is added, updated or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 3.6.0
 */
export class ApiKeyEvent extends VendureEntityEvent<ApiKey, ApiKeyInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: ApiKey,
        type: 'created' | 'updated' | 'deleted',
        input?: ApiKeyInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
