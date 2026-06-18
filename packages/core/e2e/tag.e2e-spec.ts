import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { createTestEnvironment } from '../../testing/lib/create-test-environment';

import {
    createTagDocument,
    getTagDocument,
    getTagListDocument,
    updateTagDocument,
} from './graphql/admin-definitions';

describe('Tag resolver', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('create', async () => {
        const { createTag } = await adminClient.query(createTagDocument, {
            input: { value: 'tag1' },
        });

        expect(createTag).toEqual({
            id: 'T_1',
            value: 'tag1',
        });
    });

    it('create with existing value returns existing tag', async () => {
        const { createTag } = await adminClient.query(createTagDocument, {
            input: { value: 'tag1' },
        });

        expect(createTag).toEqual({
            id: 'T_1',
            value: 'tag1',
        });
    });

    it('update', async () => {
        const { updateTag } = await adminClient.query(updateTagDocument, {
            input: { id: 'T_1', value: 'tag1-updated' },
        });

        expect(updateTag).toEqual({
            id: 'T_1',
            value: 'tag1-updated',
        });
    });

    it('tag', async () => {
        const { tag } = await adminClient.query(getTagDocument, {
            id: 'T_1',
        });

        expect(tag).toEqual({
            id: 'T_1',
            value: 'tag1-updated',
        });
    });

    it('tags', async () => {
        const { tags } = await adminClient.query(getTagListDocument);

        expect(tags).toEqual({
            items: [
                {
                    id: 'T_1',
                    value: 'tag1-updated',
                },
            ],
            totalItems: 1,
        });
    });
});
