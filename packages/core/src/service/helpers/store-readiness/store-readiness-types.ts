import { CommandErrorDefinition, CommandFix } from '@vendure/common/lib/command';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { Channel } from '../../../entity/channel/channel.entity';
import { Zone } from '../../../entity/zone/zone.entity';

/**
 * @description
 * How serious a {@link StoreReadinessFinding} is. Any `error` finding makes the store not ready. A
 * `warning` is worth fixing, but does not stop an order.
 *
 * @docsCategory services
 * @docsPage StoreReadinessService
 * @since 4.0.0
 */
export type StoreReadinessSeverity = 'error' | 'warning';

/**
 * @description
 * One way to fix a {@link StoreReadinessFinding}: an MCP admin tool, as the `vendure mcp` server names
 * it, and the input to call it with. Some inputs are templates, and the description says which
 * values to fill in. IDs in the input are database IDs, which are what the MCP tools take.
 *
 * @docsCategory services
 * @docsPage StoreReadinessService
 * @since 4.0.0
 */
export type StoreReadinessFix = CommandFix;

/**
 * @description
 * A setup gap that {@link StoreReadinessService} found. `code` is a namespaced code such as
 * `store.channel.no-default-tax-zone`. The ID fields name what the finding is about.
 *
 * @docsCategory services
 * @docsPage StoreReadinessService
 * @since 4.0.0
 */
export interface StoreReadinessFinding {
    code: string;
    severity: StoreReadinessSeverity;
    message: string;
    channelId?: ID;
    zoneId?: ID;
    countryCode?: string;
    taxCategoryId?: ID;
    fixes: StoreReadinessFix[];
    /**
     * @description
     * A Dashboard path, such as `/shipping-methods`, where a person can fix the finding.
     */
    dashboardUrl?: string;
}

/**
 * @description
 * The result of {@link StoreReadinessService} `check()`. `ready` is true when no finding has the
 * severity `error`.
 *
 * @docsCategory services
 * @docsPage StoreReadinessService
 * @since 4.0.0
 */
export interface StoreReadinessReport {
    ready: boolean;
    findings: StoreReadinessFinding[];
}

/** What a check that runs once per Channel receives. */
export interface ChannelReadinessInput {
    /** A context for the Channel being checked. */
    ctx: RequestContext;
    /** The Channel, with its default Zones loaded. */
    channel: Channel;
    /** The Zones the Channel ships to: every Zone with at least one enabled country, with its members. */
    shippingZones: Zone[];
}

/** Where a finding points and how to follow it up, besides its code and message. */
export type FindingTarget = Pick<
    StoreReadinessFinding,
    'channelId' | 'zoneId' | 'countryCode' | 'taxCategoryId' | 'dashboardUrl'
>;

/**
 * Builds a finding from a coded error definition. The code, the message and the fixes all come from
 * the definition, so they cannot drift apart.
 */
export function toFinding<Details>(
    definition: CommandErrorDefinition<Details>,
    severity: StoreReadinessSeverity,
    details: Details,
    target: FindingTarget = {},
): StoreReadinessFinding {
    return {
        code: definition.code,
        severity,
        message: definition.message(details),
        ...target,
        fixes: definition.fix?.(details) ?? [],
    };
}
