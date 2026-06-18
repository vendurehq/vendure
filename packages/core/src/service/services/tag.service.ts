import { Injectable } from '@nestjs/common';
import {
    CreateTagInput,
    DeletionResponse,
    DeletionResult,
    UpdateTagInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList, Type } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions, Taggable } from '../../common/types/common-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { VendureEntity } from '../../entity/base/base.entity';
import { Tag } from '../../entity/tag/tag.entity';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';

/**
 * @description
 * Contains methods relating to {@link Tag} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class TagService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
    ) {}

    findAll(ctx: RequestContext, options?: ListQueryOptions<Tag>): Promise<PaginatedList<Tag>> {
        return this.listQueryBuilder
            .build(Tag, options, { ctx })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    findOne(ctx: RequestContext, tagId: ID): Promise<Tag | undefined> {
        return this.connection
            .getRepository(ctx, Tag)
            .findOne({ where: { id: tagId } })
            .then(result => result ?? undefined);
    }

    create(ctx: RequestContext, input: CreateTagInput) {
        return this.tagValueToTag(ctx, input.value);
    }

    async update(ctx: RequestContext, input: UpdateTagInput) {
        const tag = await this.connection.getEntityOrThrow(ctx, Tag, input.id);
        if (input.value) {
            tag.value = input.value;
            await this.connection.getRepository(ctx, Tag).save(tag);
        }
        return tag;
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const tag = await this.connection.getEntityOrThrow(ctx, Tag, id);
        await this.connection.getRepository(ctx, Tag).remove(tag);
        return {
            result: DeletionResult.DELETED,
        };
    }

    async valuesToTags(ctx: RequestContext, values: string[]): Promise<Tag[]> {
        const tags: Tag[] = [];
        for (const value of unique(values)) {
            tags.push(await this.tagValueToTag(ctx, value));
        }
        return tags;
    }

    getTagsForEntity(ctx: RequestContext, entity: Type<VendureEntity & Taggable>, id: ID): Promise<Tag[]> {
        return this.connection
            .getRepository(ctx, entity)
            .createQueryBuilder()
            .relation(entity, 'tags')
            .of(id)
            .loadMany();
    }

    private async tagValueToTag(ctx: RequestContext, value: string): Promise<Tag> {
        const existing = await this.connection.getRepository(ctx, Tag).findOne({ where: { value } });
        if (existing) {
            return existing;
        }
        return await this.connection.getRepository(ctx, Tag).save(new Tag({ value }));
    }
}
