import { CustomFieldConfig } from '../../common/generated-types';

import { transformRelationCustomFieldInputs } from './transform-relation-custom-field-inputs';

describe('transformRelationCustomFieldInput()', () => {
    it('transforms single type', () => {
        const config: CustomFieldConfig[] = [
            { name: 'weight', type: 'int', list: false },
            { name: 'avatar', type: 'relation', list: false, entity: 'Asset' },
        ];
        const entity = {
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
                avatar: {
                    id: 123,
                    preview: '...',
                },
            },
        };

        const result = transformRelationCustomFieldInputs(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
                avatarId: 123,
            },
        } as any);
    });

    it('transforms single type with null value', () => {
        const config: CustomFieldConfig[] = [
            { name: 'avatar', type: 'relation', list: false, entity: 'Asset' },
        ];
        const entity = {
            id: 1,
            name: 'test',
            customFields: {
                avatar: null,
            },
        };

        const result = transformRelationCustomFieldInputs(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            customFields: { avatarId: null },
        } as any);
    });

    it('transforms list type', () => {
        const config: CustomFieldConfig[] = [
            { name: 'weight', type: 'int', list: false },
            { name: 'avatars', type: 'relation', list: true, entity: 'Asset' },
        ];
        const entity = {
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
                avatars: [
                    {
                        id: 123,
                        preview: '...',
                    },
                    {
                        id: 456,
                        preview: '...',
                    },
                    {
                        id: 789,
                        preview: '...',
                    },
                ],
            },
        };

        const result = transformRelationCustomFieldInputs(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
                avatarsIds: [123, 456, 789],
            },
        } as any);
    });

    it('transforms input object', () => {
        const config: CustomFieldConfig[] = [
            { name: 'weight', type: 'int', list: false },
            { name: 'avatar', type: 'relation', list: false, entity: 'Asset' },
        ];
        const entity = {
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
                avatar: {
                    id: 123,
                    preview: '...',
                },
            },
        };

        const result = transformRelationCustomFieldInputs({ input: entity }, config);
        expect(result).toEqual({
            input: {
                id: 1,
                name: 'test',
                customFields: {
                    weight: 500,
                    avatarId: 123,
                },
            },
        } as any);
    });

    it('transforms input array (as in UpdateProductVariantsInput)', () => {
        const config: CustomFieldConfig[] = [
            { name: 'weight', type: 'int', list: false },
            { name: 'avatar', type: 'relation', list: false, entity: 'Asset' },
        ];
        const entity = {
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
                avatar: {
                    id: 123,
                    preview: '...',
                },
            },
        };

        const result = transformRelationCustomFieldInputs({ input: [entity] }, config);
        expect(result).toEqual({
            input: [
                {
                    id: 1,
                    name: 'test',
                    customFields: {
                        weight: 500,
                        avatarId: 123,
                    },
                },
            ],
        } as any);
    });
});
