import { Injectable, OnModuleInit } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { Observable } from 'rxjs';

import { RequestContext } from '../../../api/common/request-context';
import { Logger } from '../../../config/logger/vendure-logger';
import { Asset } from '../../../entity/asset/asset.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';
import { Job } from '../../../job-queue/job';
import { JobQueue } from '../../../job-queue/job-queue';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { ReindexMessageResponse, UpdateIndexQueueJobData, UpdateVariantsByIdJobData } from '../types';

import { IndexerController } from './indexer.controller';

/**
 * This service is responsible for messaging the {@link IndexerController} with search index updates.
 */
@Injectable()
export class SearchIndexService implements OnModuleInit {
    private updateIndexQueue: JobQueue<UpdateIndexQueueJobData>;

    constructor(
        private jobService: JobQueueService,
        private indexerController: IndexerController,
    ) {}

    async onModuleInit() {
        this.updateIndexQueue = await this.jobService.createQueue({
            name: 'update-search-index',
            process: job => {
                const data = job.data;
                switch (data.type) {
                    case 'reindex':
                        Logger.verbose('sending ReindexMessage');
                        return this.jobWithProgress(job, this.indexerController.reindex(job));
                    case 'update-product':
                        return this.indexerController.updateProduct(data);
                    case 'update-variants':
                        return this.indexerController.updateVariants(data);
                    case 'delete-product':
                        return this.indexerController.deleteProduct(data);
                    case 'delete-variant':
                        return this.indexerController.deleteVariant(data);
                    case 'update-variants-by-id':
                        return this.jobWithProgress(
                            job,
                            this.indexerController.updateVariantsById(job as Job<UpdateVariantsByIdJobData>),
                        );
                    case 'update-asset':
                        return this.indexerController.updateAsset(data);
                    case 'delete-asset':
                        return this.indexerController.deleteAsset(data);
                    case 'assign-product-to-channel':
                        return this.indexerController.assignProductToChannel(data);
                    case 'remove-product-from-channel':
                        return this.indexerController.removeProductFromChannel(data);
                    case 'assign-variant-to-channel':
                        return this.indexerController.assignVariantToChannel(data);
                    case 'remove-variant-from-channel':
                        return this.indexerController.removeVariantFromChannel(data);
                    default:
                        assertNever(data);
                        return Promise.resolve();
                }
            },
        });
    }

    reindex(ctx: RequestContext) {
        return this.updateIndexQueue.add({ type: 'reindex', ctx: ctx.serialize() }, { ctx });
    }

    updateProduct(ctx: RequestContext, product: Product) {
        return this.updateIndexQueue.add(
            {
                type: 'update-product',
                ctx: ctx.serialize(),
                productId: product.id,
            },
            { ctx },
        );
    }

    updateVariants(ctx: RequestContext, variants: ProductVariant[]) {
        const variantIds = variants.map(v => v.id);
        return this.updateIndexQueue.add(
            { type: 'update-variants', ctx: ctx.serialize(), variantIds },
            { ctx },
        );
    }

    deleteProduct(ctx: RequestContext, product: Product) {
        return this.updateIndexQueue.add(
            {
                type: 'delete-product',
                ctx: ctx.serialize(),
                productId: product.id,
            },
            { ctx },
        );
    }

    deleteVariant(ctx: RequestContext, variants: ProductVariant[]) {
        const variantIds = variants.map(v => v.id);
        return this.updateIndexQueue.add(
            { type: 'delete-variant', ctx: ctx.serialize(), variantIds },
            { ctx },
        );
    }

    updateVariantsById(ctx: RequestContext, ids: ID[]) {
        return this.updateIndexQueue.add(
            { type: 'update-variants-by-id', ctx: ctx.serialize(), ids },
            { ctx },
        );
    }

    updateAsset(ctx: RequestContext, asset: Asset) {
        return this.updateIndexQueue.add(
            { type: 'update-asset', ctx: ctx.serialize(), asset: asset as any },
            { ctx },
        );
    }

    deleteAsset(ctx: RequestContext, asset: Asset) {
        return this.updateIndexQueue.add(
            { type: 'delete-asset', ctx: ctx.serialize(), asset: asset as any },
            { ctx },
        );
    }

    assignProductToChannel(ctx: RequestContext, productId: ID, channelId: ID) {
        return this.updateIndexQueue.add(
            {
                type: 'assign-product-to-channel',
                ctx: ctx.serialize(),
                productId,
                channelId,
            },
            { ctx },
        );
    }

    removeProductFromChannel(ctx: RequestContext, productId: ID, channelId: ID) {
        return this.updateIndexQueue.add(
            {
                type: 'remove-product-from-channel',
                ctx: ctx.serialize(),
                productId,
                channelId,
            },
            { ctx },
        );
    }

    assignVariantToChannel(ctx: RequestContext, productVariantId: ID, channelId: ID) {
        return this.updateIndexQueue.add(
            {
                type: 'assign-variant-to-channel',
                ctx: ctx.serialize(),
                productVariantId,
                channelId,
            },
            { ctx },
        );
    }

    removeVariantFromChannel(ctx: RequestContext, productVariantId: ID, channelId: ID) {
        return this.updateIndexQueue.add(
            {
                type: 'remove-variant-from-channel',
                ctx: ctx.serialize(),
                productVariantId,
                channelId,
            },
            { ctx },
        );
    }

    private jobWithProgress(
        job: Job<UpdateIndexQueueJobData>,
        ob: Observable<ReindexMessageResponse>,
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            let total: number | undefined;
            let duration = 0;
            let completed = 0;
            ob.subscribe({
                next: (response: ReindexMessageResponse) => {
                    if (!total) {
                        total = response.total;
                    }
                    duration = response.duration;
                    completed = response.completed;
                    const progress = total === 0 ? 100 : Math.ceil((completed / total) * 100);
                    job.setProgress(progress);
                },
                complete: () => {
                    resolve({
                        success: true,
                        indexedItemCount: total,
                        timeTaken: duration,
                    });
                },
                error: (err: any) => {
                    Logger.error(err.message || JSON.stringify(err), undefined, err.stack);
                    reject(err);
                },
            });
        });
    }
}
