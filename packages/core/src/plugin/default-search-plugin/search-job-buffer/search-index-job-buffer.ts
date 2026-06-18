import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { Job } from '../../../job-queue/job';
import { JobBuffer } from '../../../job-queue/job-buffer/job-buffer';
import {
    UpdateIndexQueueJobData,
    UpdateProductJobData,
    UpdateVariantsByIdJobData,
    UpdateVariantsJobData,
} from '../types';

export class SearchIndexJobBuffer implements JobBuffer<UpdateIndexQueueJobData> {
    readonly id = 'search-plugin-update-search-index';

    collect(job: Job<UpdateIndexQueueJobData>): boolean | Promise<boolean> {
        return (
            job.queueName === 'update-search-index' &&
            ['update-product', 'update-variants', 'update-variants-by-id'].includes(job.data.type)
        );
    }

    reduce(collectedJobs: Array<Job<UpdateIndexQueueJobData>>): Array<Job<any>> {
        const variantsJobs = this.removeBy<Job<UpdateVariantsByIdJobData | UpdateVariantsJobData>>(
            collectedJobs,
            item => item.data.type === 'update-variants-by-id' || item.data.type === 'update-variants',
        );
        const productsJobs = this.removeBy<Job<UpdateProductJobData>>(
            collectedJobs,
            item => item.data.type === 'update-product',
        );
        const jobsToAdd = [...collectedJobs];

        if (variantsJobs.length) {
            const variantIdsToUpdate: ID[] = [];
            for (const job of variantsJobs) {
                const ids = job.data.type === 'update-variants-by-id' ? job.data.ids : job.data.variantIds;
                variantIdsToUpdate.push(...ids);
            }

            const referenceJob = variantsJobs[0];
            const batchedVariantJob = new Job<UpdateVariantsByIdJobData>({
                ...referenceJob,
                id: undefined,
                data: {
                    type: 'update-variants-by-id',
                    ids: unique(variantIdsToUpdate),
                    ctx: referenceJob.data.ctx,
                },
            });

            jobsToAdd.push(batchedVariantJob as Job);
        }
        if (productsJobs.length) {
            const seenIds = new Set<ID>();
            const uniqueProductJobs: Array<Job<UpdateProductJobData>> = [];
            for (const job of productsJobs) {
                if (seenIds.has(job.data.productId)) {
                    continue;
                }
                uniqueProductJobs.push(job);
                seenIds.add(job.data.productId);
            }
            jobsToAdd.push(...(uniqueProductJobs as Job[]));
        }
        return jobsToAdd;
    }

    /**
     * Removes items from the array based on the filterFn and returns a new array with only the removed
     * items. The original input array is mutated.
     */
    private removeBy<R extends T, T = any>(input: T[], filterFn: (item: T) => boolean): R[] {
        const removed: R[] = [];
        for (let i = input.length - 1; i >= 0; i--) {
            const item = input[i];
            if (filterFn(item)) {
                removed.push(item as R);
                input.splice(i, 1);
            }
        }
        return removed;
    }
}
