/* eslint-disable no-console */
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

import { getDataSource } from '../connection/get-data-source';

/**
 * @description
 * One slug that more than one Product or Collection uses in the same channel and language.
 *
 * @since 4.0.0
 * @docsCategory migration
 */
export interface SlugConflict {
    entity: 'Product' | 'Collection';
    /**
     * The channel code. For the default channel, only entities which belong to no other
     * channel are compared, because the default channel holds every entity.
     */
    channelCode: string;
    languageCode: string;
    slug: string;
    entityIds: string[];
}

/**
 * @description
 * Lists the slugs that break the v4 rule that a Product or Collection slug is unique per
 * language in each channel the entity belongs to. This helper only reads: v4 does not change
 * the schema for this rule, and no data has to change for the server to start.
 *
 * Before v4 the slug check only looked at the active channel, and assigning to a channel
 * did not check slugs at all, so an existing database can hold such duplicates. A lookup by
 * a duplicated slug returns one of the matches. In v4 the choice is deterministic (see
 * `SlugValidator.resolveSlug()`), but it is still worth renaming the duplicates.
 *
 * Call it from a migration's `up()` to log the conflicts, or from a script:
 *
 * ```ts
 * const conflicts = await findSlugConflicts(queryRunner);
 * console.log(formatSlugConflicts(conflicts));
 * ```
 *
 * @since 4.0.0
 * @docsCategory migration
 */
export async function findSlugConflicts(queryRunner: QueryRunner): Promise<SlugConflict[]> {
    const esc = (name: string) => getDataSource(queryRunner).driver.escape(name);
    const defaultRows: Array<{ id: string | number }> = await queryRunner.query(
        `SELECT ${esc('id')} FROM ${esc('channel')} WHERE ${esc('code')} = '${DEFAULT_CHANNEL_CODE}'`,
    );
    if (!defaultRows.length) {
        return [];
    }
    const defaultChannelId = String(defaultRows[0].id);
    const tables: SlugTable[] = [
        { entity: 'Product', base: 'product', softDelete: true },
        { entity: 'Collection', base: 'collection', softDelete: false },
    ];
    const conflicts: SlugConflict[] = [];
    // One after the other: a QueryRunner holds a single connection.
    for (const table of tables) {
        const rows = await readSlugRows(queryRunner, table);
        conflicts.push(...findConflictsInRows(table.entity, rows, defaultChannelId));
    }
    return conflicts;
}

interface SlugTable {
    entity: SlugConflict['entity'];
    base: string;
    softDelete: boolean;
}

interface SlugRow {
    id: string | number;
    channelId: string | number;
    channelCode: string;
    languageCode: string;
    slug: string;
}

/**
 * One row per (entity, translation, channel) for every non-deleted entity with a slug.
 */
function readSlugRows(queryRunner: QueryRunner, { base, softDelete }: SlugTable): Promise<SlugRow[]> {
    const esc = (name: string) => getDataSource(queryRunner).driver.escape(name);
    const t = esc(`${base}_translation`);
    const b = esc(base);
    const j = esc(`${base}_channels_channel`);
    const notDeleted = softDelete ? `AND ${b}.${esc('deletedAt')} IS NULL` : '';
    return queryRunner.query(
        `SELECT ${b}.${esc('id')} AS ${esc('id')}, ${j}.${esc('channelId')} AS ${esc('channelId')},
                c.${esc('code')} AS ${esc('channelCode')},
                ${t}.${esc('languageCode')} AS ${esc('languageCode')}, ${t}.${esc('slug')} AS ${esc('slug')}
         FROM ${t}
         INNER JOIN ${b} ON ${b}.${esc('id')} = ${t}.${esc('baseId')}
         INNER JOIN ${j} ON ${j}.${esc(`${base}Id`)} = ${b}.${esc('id')}
         INNER JOIN ${esc('channel')} c ON c.${esc('id')} = ${j}.${esc('channelId')}
         WHERE ${t}.${esc('slug')} IS NOT NULL ${notDeleted}`,
    );
}

/**
 * Groups the rows by (channel, language, slug) and returns the groups with more than one
 * entity. In the default channel, which holds every entity, only entities that belong to no
 * other channel are compared.
 */
function findConflictsInRows(
    entity: SlugConflict['entity'],
    rows: SlugRow[],
    defaultChannelId: string,
): SlugConflict[] {
    const channelCount = new Map<string, number>();
    for (const r of rows) {
        if (String(r.channelId) !== defaultChannelId) {
            channelCount.set(String(r.id), (channelCount.get(String(r.id)) ?? 0) + 1);
        }
    }
    const groups = new Map<string, Omit<SlugConflict, 'entityIds'> & { ids: Set<string> }>();
    for (const r of rows) {
        const id = String(r.id);
        const inDefault = String(r.channelId) === defaultChannelId;
        if (inDefault && channelCount.has(id)) {
            // Also in another channel, so it is compared there instead.
            continue;
        }
        const channelCode = inDefault ? DEFAULT_CHANNEL_CODE : r.channelCode;
        const key = [String(r.channelId), r.languageCode, r.slug].join('\u0000');
        const group = groups.get(key) ?? {
            entity,
            channelCode,
            languageCode: r.languageCode,
            slug: r.slug,
            ids: new Set<string>(),
        };
        group.ids.add(id);
        groups.set(key, group);
    }
    return [...groups.values()]
        .filter(group => group.ids.size > 1)
        .map(({ ids, ...rest }) => ({
            ...rest,
            entityIds: [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        }));
}

/**
 * @description
 * Formats the output of {@link findSlugConflicts} for a log.
 *
 * @since 4.0.0
 * @docsCategory migration
 */
export function formatSlugConflicts(conflicts: SlugConflict[]): string {
    if (!conflicts.length) {
        return 'No slug conflicts found.';
    }
    const lines = conflicts.map(
        c =>
            `${c.entity} slug "${c.slug}" (${c.languageCode}) in channel ${c.channelCode}: ids ${c.entityIds.join(', ')}`,
    );
    return [`${conflicts.length} slug conflict(s) found:`, ...lines].join('\n');
}
