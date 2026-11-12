import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { RequestContext } from '../../../api/common/request-context';
import { UserInputError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { SlugUniquenessScope } from '../../../config/entity/slug-strategy';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { VendureEntity } from '../../../entity/base/base.entity';
import { ChannelService } from '../../services/channel.service';

/**
 * @docsCategory service-helpers
 * @docsPage SlugValidator
 */
export type InputWithSlug = {
    id?: ID | null;
    translations?: Array<{
        id?: ID | null;
        languageCode: LanguageCode;
        slug?: string | null;
    }> | null;
};

/**
 * @docsCategory service-helpers
 * @docsPage SlugValidator
 */
export type TranslationEntity = VendureEntity & {
    id: ID;
    languageCode: LanguageCode;
    slug: string;
    base: any;
};

/**
 * @description
 * The set of channels within which a slug must be unique. `'global'` means every channel.
 */
export type SlugScope = ID[] | 'global';

/**
 * @description
 * Used to validate slugs to ensure they are URL-safe and unique. Designed to be used with translatable
 * entities such as {@link Product} and {@link Collection}.
 *
 * With the default uniqueness scope of `'channel'` (see {@link SlugStrategy}), a slug must be unique (per language)
 * in every channel the entity belongs to. The default channel is a special case: every entity
 * is assigned to it, so it is only taken into account for entities that belong to no other
 * channel. Such entities are checked against every entity, which keeps a single-channel shop
 * behaving exactly as before.
 *
 * @docsCategory service-helpers
 * @docsWeight 0
 */
@Injectable()
export class SlugValidator {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private channelService: ChannelService,
    ) {}

    /**
     * Normalizes the slug to be URL-safe, and ensures it is unique for the given languageCode
     * within the channels the entity belongs to. Mutates the input.
     */
    async validateSlugs<T extends InputWithSlug, E extends TranslationEntity>(
        ctx: RequestContext,
        input: T,
        translationEntity: Type<E>,
    ): Promise<T> {
        if (!input.translations?.some(t => !!t.slug)) {
            return input;
        }
        const scope = await this.getScope(ctx, translationEntity, input.id ?? undefined);
        const storedSlugs = await this.getStoredSlugs(ctx, translationEntity, input.id ?? undefined);
        for (const t of input.translations) {
            if (t.slug) {
                t.slug = normalizeString(t.slug, '-');
                if (storedSlugs.get(t.languageCode) === t.slug) {
                    // An unchanged slug is never renamed: that would change a live URL on an
                    // unrelated edit, e.g. when another channel's entity already shares it.
                    continue;
                }
                let match: E | null;
                let suffix = 1;
                const seen: ID[] = [];
                const alreadySuffixed = /-\d+$/;
                do {
                    const qb = this.connection
                        .getRepository(ctx, translationEntity)
                        .createQueryBuilder('translation')
                        .innerJoinAndSelect('translation.base', 'base')
                        .andWhere('translation.slug = :slug', { slug: t.slug })
                        .andWhere('translation.languageCode = :languageCode', {
                            languageCode: t.languageCode,
                        });
                    if (scope !== 'global') {
                        qb.innerJoin('base.channels', 'channel').andWhere('channel.id IN (:...scope)', {
                            scope,
                        });
                    }
                    if (input.id) {
                        qb.andWhere('translation.base != :id', { id: input.id });
                    }
                    if (seen.length) {
                        qb.andWhere('translation.id NOT IN (:...seen)', { seen });
                    }
                    match = await qb.getOne();
                    if (match) {
                        if (!match.base.deletedAt) {
                            suffix++;
                            if (alreadySuffixed.test(t.slug)) {
                                t.slug = t.slug.replace(alreadySuffixed, `-${suffix}`);
                            } else {
                                t.slug = `${t.slug}-${suffix}`;
                            }
                        } else {
                            seen.push(match.id);
                        }
                    }
                } while (match);
            }
        }
        return input;
    }

    /**
     * @description
     * Throws if assigning the given entities to the channel would leave two non-deleted entities
     * with the same slug and language in that channel. Called before the assignment is written.
     *
     * The slug lives on the translation row, which is shared by every channel the entity is in,
     * so the conflict cannot be resolved by renaming in the target channel only. Rejecting the
     * assignment is the only behaviour that cannot silently change a URL in another channel.
     */
    async assertNoConflictsInChannel<E extends TranslationEntity>(
        ctx: RequestContext,
        translationEntity: Type<E>,
        entityIds: ID[],
        channelId: ID,
    ): Promise<void> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (!entityIds.length || idsAreEqual(defaultChannel.id, channelId)) {
            // Every entity is already in the default channel.
            return;
        }
        const repo = this.connection.getRepository(ctx, translationEntity);
        // Entities already in the channel are not being added to it, so they cannot add a clash.
        const alreadyAssigned: Array<{ id: ID }> = await repo
            .createQueryBuilder('translation')
            .innerJoin('translation.base', 'base')
            .innerJoin('base.channels', 'channel')
            .where('base.id IN (:...entityIds)', { entityIds })
            .andWhere('channel.id = :channelId', { channelId })
            .select('base.id', 'id')
            .distinct(true)
            .getRawMany();
        // This runs for both uniqueness scopes: with 'global', existing data may still hold
        // per-channel duplicates written before the scope was switched.
        const baseIds = entityIds.filter(id => !alreadyAssigned.some(a => idsAreEqual(a.id, id)));
        if (!baseIds.length) {
            return;
        }
        const incoming = await repo
            .createQueryBuilder('translation')
            .innerJoinAndSelect('translation.base', 'base')
            .where('base.id IN (:...baseIds)', { baseIds })
            .andWhere(this.notDeleted(translationEntity))
            .getMany();
        if (!incoming.length) {
            return;
        }
        const conflicts: string[] = [];
        // Conflicts among the entities being assigned.
        const seen = new Map<string, ID>();
        for (const t of incoming) {
            const key = `${t.languageCode}:${t.slug}`;
            const other = seen.get(key);
            if (other != null && !idsAreEqual(other, t.base.id)) {
                conflicts.push(t.slug);
            }
            seen.set(key, t.base.id);
        }
        // Conflicts with entities already in the target channel.
        const existing = await repo
            .createQueryBuilder('translation')
            .innerJoin('translation.base', 'base')
            .innerJoin('base.channels', 'channel')
            .where('channel.id = :channelId', { channelId })
            .andWhere(this.notDeleted(translationEntity))
            .andWhere('base.id NOT IN (:...baseIds)', { baseIds })
            .andWhere('translation.slug IN (:...slugs)', { slugs: unique(incoming.map(t => t.slug)) })
            .getMany();
        for (const e of existing) {
            if (incoming.some(t => t.slug === e.slug && t.languageCode === e.languageCode)) {
                conflicts.push(e.slug);
            }
        }
        if (conflicts.length) {
            throw new UserInputError('error.slug-conflict-in-channel', {
                slugs: unique(conflicts).join(', '),
            });
        }
    }

    /**
     * @description
     * Finds the id of the entity with this slug in the active channel. More than one entity can
     * match: the slug may exist in several languages, and the default channel holds entities
     * from every channel. The order is: a translation in the request language, then in the
     * channel default language; then (in the default channel) an entity that belongs to no
     * other channel; then the oldest entity, then the lowest id.
     *
     * It lives here because the order mirrors the uniqueness rule in {@link getScope}: an
     * entity that only lives in the default channel owns its slug there.
     */
    async resolveSlug<E extends TranslationEntity>(
        ctx: RequestContext,
        translationEntity: Type<E>,
        slug: string,
    ): Promise<ID | undefined> {
        const repo = this.connection.getRepository(ctx, translationEntity);
        const rows: Array<{ id: ID; languageCode: LanguageCode; createdAt: Date | string }> = await repo
            .createQueryBuilder('translation')
            .innerJoin('translation.base', 'base')
            .innerJoin('base.channels', 'channel')
            .where('channel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('translation.slug = :slug', { slug })
            .andWhere(this.notDeleted(translationEntity))
            .select('base.id', 'id')
            .addSelect('translation.languageCode', 'languageCode')
            .addSelect('base.createdAt', 'createdAt')
            .getRawMany();
        if (!rows.length) {
            return undefined;
        }
        const languageRank = (code: LanguageCode) => {
            if (code === ctx.languageCode) {
                return 2;
            }
            return code === ctx.channel.defaultLanguageCode ? 1 : 0;
        };
        const best = new Map<string, { id: ID; rank: number; createdAt: number }>();
        for (const row of rows) {
            const key = String(row.id);
            const rank = languageRank(row.languageCode);
            const existing = best.get(key);
            if (!existing || existing.rank < rank) {
                best.set(key, { id: row.id, rank, createdAt: new Date(row.createdAt).getTime() });
            }
        }
        let candidates = [...best.values()];
        const topRank = Math.max(...candidates.map(c => c.rank));
        candidates = candidates.filter(c => c.rank === topRank);
        if (candidates.length > 1) {
            const defaultChannel = await this.channelService.getDefaultChannel(ctx);
            if (idsAreEqual(defaultChannel.id, ctx.channelId)) {
                const inOtherChannels: Array<{ id: ID }> = await repo
                    .createQueryBuilder('translation')
                    .innerJoin('translation.base', 'base')
                    .innerJoin('base.channels', 'channel')
                    .where('base.id IN (:...ids)', { ids: candidates.map(c => c.id) })
                    .andWhere('channel.id != :defaultChannelId', { defaultChannelId: defaultChannel.id })
                    .select('base.id', 'id')
                    .distinct(true)
                    .getRawMany();
                const defaultOnly = candidates.filter(
                    c => !inOtherChannels.some(o => idsAreEqual(o.id, c.id)),
                );
                if (defaultOnly.length) {
                    candidates = defaultOnly;
                }
            }
        }
        candidates.sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id));
        return candidates[0].id;
    }

    /**
     * @description
     * Returns the channels within which the slug must be unique for this entity, or `'global'`.
     * Also used by the {@link EntitySlugService} so that `slugForEntity` suggestions agree with
     * the validation.
     */
    async getScope(ctx: RequestContext, translationEntity: Type<any>, baseId?: ID): Promise<SlugScope> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        let channelIds: ID[];
        if (baseId != null) {
            const rows: Array<{ id: ID }> = await this.connection
                .getRepository(ctx, translationEntity)
                .createQueryBuilder('translation')
                .innerJoin('translation.base', 'base')
                .innerJoin('base.channels', 'channel')
                .where('base.id = :baseId', { baseId })
                .select('channel.id', 'id')
                .distinct(true)
                .getRawMany();
            channelIds = rows.map(r => r.id);
            if (!channelIds.length) {
                channelIds = [ctx.channelId];
            }
        } else {
            // A new entity is assigned to the active channel and the default channel.
            channelIds = [ctx.channelId];
        }
        const uniqueness = await this.getUniquenessScope(ctx, translationEntity, baseId, channelIds);
        if (uniqueness === 'global') {
            return 'global';
        }
        const nonDefault = channelIds.filter(id => !idsAreEqual(id, defaultChannel.id));
        // An entity that only lives in the default channel is checked against every entity.
        return nonDefault.length ? nonDefault : 'global';
    }

    private async getStoredSlugs(
        ctx: RequestContext,
        translationEntity: Type<any>,
        baseId?: ID,
    ): Promise<Map<LanguageCode, string>> {
        if (baseId == null) {
            return new Map();
        }
        const rows: Array<{ languageCode: LanguageCode; slug: string }> = await this.connection
            .getRepository(ctx, translationEntity)
            .createQueryBuilder('translation')
            .innerJoin('translation.base', 'base')
            .where('base.id = :baseId', { baseId })
            .select('translation.languageCode', 'languageCode')
            .addSelect('translation.slug', 'slug')
            .getRawMany();
        return new Map(rows.map(r => [r.languageCode, r.slug]));
    }

    private async getUniquenessScope(
        ctx: RequestContext,
        translationEntity: Type<any>,
        entityId: ID | undefined,
        channelIds: ID[],
    ): Promise<SlugUniquenessScope> {
        const strategy = this.configService.entityOptions.slugStrategy;
        if (!strategy?.getUniquenessScope) {
            return 'channel';
        }
        const entityName =
            this.connection.rawConnection.getMetadata(translationEntity).findRelationWithPropertyPath('base')
                ?.inverseEntityMetadata.name ?? translationEntity.name;
        return strategy.getUniquenessScope(ctx, { entityName, entityId, channelIds });
    }

    private notDeleted<E extends TranslationEntity>(translationEntity: Type<E>): string {
        const baseMetadata = this.connection.rawConnection
            .getMetadata(translationEntity)
            .findRelationWithPropertyPath('base')?.inverseEntityMetadata;
        return baseMetadata?.findColumnWithPropertyName('deletedAt') ? 'base.deletedAt IS NULL' : '1 = 1';
    }
}

/**
 * Orders numeric ids numerically and other ids (e.g. UUIDs) as strings.
 */
function compareIds(a: ID, b: ID): number {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
        return na - nb;
    }
    return String(a).localeCompare(String(b));
}
