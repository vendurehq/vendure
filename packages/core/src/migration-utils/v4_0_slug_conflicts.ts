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
 * `SlugStrategy.getUniquenessScope()`), but it is still worth renaming the duplicates.
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
    const results: SlugConflict[] = [];
    const tables = [
        { entity: 'Product' as const, base: 'product', softDelete: true },
        { entity: 'Collection' as const, base: 'collection', softDelete: false },
    ];
    const defaultRows: Array<{ id: string | number }> = await queryRunner.query(
        `SELECT ${esc('id')} FROM ${esc('channel')} WHERE ${esc('code')} = '${DEFAULT_CHANNEL_CODE}'`,
    );
    if (!defaultRows.length) {
        return results;
    }
    const defaultChannelId = defaultRows[0].id;
    for (const { entity, base, softDelete } of tables) {
        const t = esc(`${base}_translation`);
        const b = esc(base);
        const j = esc(`${base}_channels_channel`);
        const baseFk = esc(`${base}Id`);
        const notDeleted = softDelete ? `AND ${b}.${esc('deletedAt')} IS NULL` : '';
        const rows: Array<{
            id: string | number;
            channelId: string | number;
            channelCode: string;
            languageCode: string;
            slug: string;
        }> = await queryRunner.query(
            `SELECT ${b}.${esc('id')} AS ${esc('id')}, ${j}.${esc('channelId')} AS ${esc('channelId')},
                    c.${esc('code')} AS ${esc('channelCode')},
                    ${t}.${esc('languageCode')} AS ${esc('languageCode')}, ${t}.${esc('slug')} AS ${esc('slug')}
             FROM ${t}
             INNER JOIN ${b} ON ${b}.${esc('id')} = ${t}.${esc('baseId')}
             INNER JOIN ${j} ON ${j}.${baseFk} = ${b}.${esc('id')}
             INNER JOIN ${esc('channel')} c ON c.${esc('id')} = ${j}.${esc('channelId')}
             WHERE ${t}.${esc('slug')} IS NOT NULL ${notDeleted}`,
        );
        // Channels per entity, to find the ones that live only in the default channel.
        const channelsByEntity = new Map<string, Set<string>>();
        for (const r of rows) {
            const set = channelsByEntity.get(String(r.id)) ?? new Set<string>();
            set.add(String(r.channelId));
            channelsByEntity.set(String(r.id), set);
        }
        const isDefaultOnly = (id: string) => {
            const set = channelsByEntity.get(id);
            return !!set && set.size === 1 && set.has(String(defaultChannelId));
        };
        // 1. Conflicts within each non-default channel.
        const groups = new Map<
            string,
            { channelCode: string; languageCode: string; slug: string; ids: Set<string> }
        >();
        // 2. Entities that live only in the default channel must not share a slug.
        const defaultOnlyBySlug = new Map<string, Set<string>>();
        for (const r of rows) {
            const id = String(r.id);
            const slugKey = `${r.languageCode}\u0000${r.slug}`;
            if (String(r.channelId) === String(defaultChannelId)) {
                if (isDefaultOnly(id)) {
                    const set = defaultOnlyBySlug.get(slugKey) ?? new Set<string>();
                    set.add(id);
                    defaultOnlyBySlug.set(slugKey, set);
                }
                continue;
            }
            const key = `${String(r.channelId)}\u0000${slugKey}`;
            const g = groups.get(key) ?? {
                channelCode: r.channelCode,
                languageCode: r.languageCode,
                slug: r.slug,
                ids: new Set<string>(),
            };
            g.ids.add(id);
            groups.set(key, g);
        }
        for (const g of groups.values()) {
            if (g.ids.size > 1) {
                results.push({
                    entity,
                    channelCode: g.channelCode,
                    languageCode: g.languageCode,
                    slug: g.slug,
                    entityIds: [...g.ids].sort(),
                });
            }
        }
        for (const [slugKey, ids] of defaultOnlyBySlug) {
            if (ids.size > 1) {
                const [languageCode, slug] = slugKey.split('\u0000');
                results.push({
                    entity,
                    channelCode: DEFAULT_CHANNEL_CODE,
                    languageCode,
                    slug,
                    entityIds: [...ids].sort(),
                });
            }
        }
    }
    return results;
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
