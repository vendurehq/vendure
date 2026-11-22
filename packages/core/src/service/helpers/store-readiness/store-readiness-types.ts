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
