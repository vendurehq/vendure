import {
    CreateFacetInput,
    FacetTranslationInput,
    LanguageCode,
    Permission,
} from '@vendure/common/lib/generated-types';

import { Injector } from '../../../common/injector';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { FacetValue } from '../../../entity/facet-value/facet-value.entity';
import { Facet } from '../../../entity/facet/facet.entity';
import { ChannelAssignmentService } from '../../../service/helpers/channel-assignment/channel-assignment.service';
import { FacetValueService } from '../../../service/services/facet-value.service';
import { FacetService } from '../../../service/services/facet.service';
import { EntityDuplicator } from '../entity-duplicator';

let channelAssignmentService: ChannelAssignmentService;
let connection: TransactionalConnection;
let facetService: FacetService;
let facetValueService: FacetValueService;

/**
 * @description
 * Duplicates a Facet
 */
export const facetDuplicator = new EntityDuplicator({
    code: 'facet-duplicator',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Default duplicator for Facets',
        },
    ],
    requiresPermission: [Permission.CreateFacet, Permission.CreateCatalog],
    forEntities: ['Facet'],
    args: {
        includeFacetValues: {
            type: 'boolean',
            defaultValue: true,
            label: [{ languageCode: LanguageCode.en, value: 'Include facet values' }],
        },
    },
    init(injector: Injector) {
        connection = injector.get(TransactionalConnection);
        channelAssignmentService = injector.get(ChannelAssignmentService);
        facetService = injector.get(FacetService);
        facetValueService = injector.get(FacetValueService);
    },
    async duplicate({ ctx, id, args }) {
        const facet = await connection.getEntityOrThrow(ctx, Facet, id, {
            channelId: ctx.channelId,
        });
        const translations: FacetTranslationInput[] = facet.translations.map(translation => {
            return {
                name: translation.name + ' (copy)',
                languageCode: translation.languageCode,
                customFields: translation.customFields,
            };
        });
        const facetInput: CreateFacetInput = {
            isPrivate: true,
            translations,
            customFields: await channelAssignmentService.getCustomFieldsToCopy(ctx, Facet, facet),
            code: facet.code + '-copy',
        };

        const duplicatedFacet = await facetService.create(ctx, facetInput);
        if (args.includeFacetValues) {
            // A Facet can be assigned to a channel without all of its FacetValues being
            // assigned too, so the values are scoped to the active channel as well as
            // to the parent Facet.
            const facetValues = await connection.getRepository(ctx, FacetValue).find({
                where: {
                    facet: { id: facet.id },
                    channels: { id: ctx.channelId },
                },
            });
            for (const value of facetValues) {
                const newValue = await facetValueService.create(ctx, duplicatedFacet, {
                    code: value.code + '-copy',
                    translations: value.translations.map(translation => ({
                        name: translation.name + ' (copy)',
                        languageCode: translation.languageCode,
                        customFields: translation.customFields,
                    })),
                    facetId: duplicatedFacet.id,
                    customFields: await channelAssignmentService.getCustomFieldsToCopy(
                        ctx,
                        FacetValue,
                        value,
                    ),
                });
                duplicatedFacet.values.push(newValue);
            }
        }
        return duplicatedFacet;
    },
});
