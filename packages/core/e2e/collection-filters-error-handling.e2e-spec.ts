import { JobState, LanguageCode } from '@vendure/common/lib/generated-types';
import { CollectionFilter, defaultCollectionFilters, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createCollectionDocument,
    getRunningJobsDocument,
    updateCollectionDocument,
} from './graphql/shared-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

/**
 * Stands in for the ways in which applying a Collection's filters can fail in production: a
 * CollectionFilter implementation throwing, or the database rejecting the membership write.
 */
let filterShouldFail = false;
const flakyCollectionFilter = new CollectionFilter({
    args: {},
    code: 'flaky-collection-filter',
    description: [{ languageCode: LanguageCode.en, value: 'Fails when told to' }],
    apply: qb => {
        if (filterShouldFail) {
            throw new Error('Simulated failure while applying the collection filter');
        }
        return qb.andWhere('1 = 1');
    },
});

/**
 * The apply-collection-filters job used to swallow any failure and still report a successful run,
 * which left the Collection's contents silently out of sync with its filters.
 */
describe('Collection filters error handling', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            catalogOptions: {
                collectionFilters: [...defaultCollectionFilters, flakyCollectionFilter],
            },
        }),
    );

    let collectionId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        filterShouldFail = false;
        await server.destroy();
    });

    async function getApplyFiltersJobStates(): Promise<string[]> {
        const { jobs } = await adminClient.query(getRunningJobsDocument, {
            options: { filter: { queueName: { eq: 'apply-collection-filters' } } },
        });
        return jobs.items.map(job => job.state);
    }

    it('completes the job when the filters apply successfully', async () => {
        filterShouldFail = false;
        const { createCollection } = await adminClient.query(createCollectionDocument, {
            input: {
                filters: [{ code: flakyCollectionFilter.code, arguments: [] }],
                translations: [
                    { languageCode: LanguageCode.en, name: 'flaky', description: '', slug: 'flaky' },
                ],
            },
        });
        collectionId = createCollection.id;
        await awaitRunningJobs(adminClient);

        const states = await getApplyFiltersJobStates();
        expect(states.length).toBeGreaterThan(0);
        expect(states.every(state => state === JobState.COMPLETED)).toBe(true);
    });

    it('fails the job when the filters cannot be applied', async () => {
        filterShouldFail = true;
        await adminClient.query(updateCollectionDocument, {
            input: {
                id: collectionId,
                filters: [{ code: flakyCollectionFilter.code, arguments: [] }],
            },
        });
        await awaitRunningJobs(adminClient);

        const states = await getApplyFiltersJobStates();
        expect(states).toContain(JobState.FAILED);
    });
});
