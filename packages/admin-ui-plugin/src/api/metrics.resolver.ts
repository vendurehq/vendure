import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { MetricsService } from '../service/metrics.service';
import { MetricSummary, MetricSummaryInput } from '../types';

@Resolver()
export class MetricsResolver {
    constructor(private service: MetricsService) {}

    @Query()
    @Allow(Permission.ReadOrder)
    async metricSummary(
        @Ctx() ctx: RequestContext,
        @Args('input') input: MetricSummaryInput,
    ): Promise<MetricSummary[]> {
        return this.service.getMetrics(ctx, input);
    }
}
