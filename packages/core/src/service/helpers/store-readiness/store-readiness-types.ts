import { CommandErrorDefinition } from '@vendure/common/lib/command';
import {
    StoreReadinessFinding,
    StoreReadinessFix,
    StoreReadinessSeverity,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { idsAreEqual } from '../../../common/utils';
import { Channel } from '../../../entity/channel/channel.entity';
import { Zone } from '../../../entity/zone/zone.entity';

/**
 * The report, its findings and their fixes are the generated Admin API types, so the service, the
 * resolver and the MCP tool share one definition.
 */
export { StoreReadinessSeverity } from '@vendure/common/lib/generated-types';
export type {
    StoreReadinessFinding,
    StoreReadinessFix,
    StoreReadinessReport,
} from '@vendure/common/lib/generated-types';

/** What a check that runs once per Channel receives. */
export interface ChannelReadinessInput {
    /** A context for the Channel being checked. */
    ctx: RequestContext;
    /** The active Channel of the caller, whose tool calls a fix makes. */
    callerChannelId: ID;
    /**
     * A new context for the Channel. Core caches the active tax zone per context, so each sample order
     * is priced with a context of its own.
     */
    newContext: () => Promise<RequestContext>;
    /** The Channel, with its default Zones loaded. */
    channel: Channel;
    /** Every Zone, with its members, which the tax zone strategy chooses from. */
    allZones: Zone[];
    /** The Zones the Channel ships to: every Zone with at least one enabled country, with its members. */
    shippingZones: Zone[];
}

/**
 * @description
 * The MCP admin tools that store readiness fixes name, without the `admin_` prefix that `vendure mcp`
 * adds. They are defined by the MCP plugin, so this list is the one place core names them.
 *
 * @docsCategory services
 * @docsPage StoreReadinessService
 * @since 4.0.0
 */
export const STORE_READINESS_FIX_TOOLS = [
    'set_active_channel',
    'update_channel',
    'list_zones',
    'update_zone',
    'enable_countries',
    'create_tax_rate',
    'list_shipping_methods',
    'list_shipping_options',
    'create_shipping_method',
    'update_shipping_method',
    'list_payment_options',
    'create_payment_method',
    'create_stock_location',
] as const;

/** The path of a fix that calls an MCP admin tool, as `vendure mcp` names it. */
export function adminToolPath(tool: (typeof STORE_READINESS_FIX_TOOLS)[number]): string[] {
    return [`admin_${tool}`];
}

/**
 * Fixes that create or list entities of a Channel act on the caller's active Channel. When the
 * finding is about another Channel, the fixes start by switching to it.
 */
export function inChannel(input: ChannelReadinessInput, fixes: StoreReadinessFix[]): StoreReadinessFix[] {
    if (fixes.length === 0 || idsAreEqual(input.callerChannelId, input.channel.id)) {
        return fixes;
    }
    return [
        {
            path: adminToolPath('set_active_channel'),
            input: { channelToken: input.channel.token },
            description: `Switch to channel "${input.channel.code}", which this finding is about.`,
        },
        ...fixes,
    ];
}

/** Zone members are Regions. Only countries count as places an order can ship to. */
export function countryMembers(zone: Zone) {
    return zone.members.filter(member => member.type === 'country');
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
