import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Zone } from '../../entity/zone/zone.entity';

/**
 * @description
 * Defines how the complete set of Zones is cached. The RequestContext is provided to every
 * operation so that custom strategies have the information needed to determine cache behavior.
 *
 * @docsCategory cache
 * @docsPage ZoneCacheStrategy
 * @docsWeight 0
 * @since 3.8.0
 */
export interface ZoneCacheStrategy extends InjectableStrategy {
    /**
     * @description
     * Returns the cached Zones, invoking `load` when no cached value is available.
     */
    get(ctx: RequestContext, load: () => Promise<Zone[]>): Promise<Zone[]>;
    /**
     * @description
     * Updates the cached Zones.
     */
    set(ctx: RequestContext, zones: Zone[]): void | Promise<void>;
    /**
     * @description
     * Deletes the cached Zones.
     */
    delete(ctx: RequestContext): void | Promise<void>;
    /**
     * @description
     * Clears every cached Zone entry.
     */
    clear(): void | Promise<void>;
}
