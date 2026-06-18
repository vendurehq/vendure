import { UpdateGlobalSettingsInput } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api';
import { GlobalSettings } from '../../entity/global-settings/global-settings.entity';
import { VendureEntityEvent } from '../vendure-entity-event';

/**
 * @description
 * This event is fired whenever a {@link GlobalSettings} is added. The type is always `updated`, because it's
 * only created once and never deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class GlobalSettingsEvent extends VendureEntityEvent<GlobalSettings, UpdateGlobalSettingsInput> {
    constructor(ctx: RequestContext, entity: GlobalSettings, input?: UpdateGlobalSettingsInput) {
        super(entity, 'updated', ctx, input);
    }
}
