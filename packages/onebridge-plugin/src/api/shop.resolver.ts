import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission } from '@vendure/core';

import {
    OnebridgeContentService,
    OnebridgeCustomsService,
    OnebridgeInspectionService,
    OnebridgeOrderSummaryService,
    OnebridgeRfqService,
} from '../services';

@Resolver('Rfq')
export class RfqFieldResolver {
    constructor(private rfqService: OnebridgeRfqService) {}

    @ResolveField()
    customer(@Parent() rfq: any) {
        return {
            name: rfq.customerName,
            contact: rfq.customerContact,
            locale: rfq.locale,
            customerId: rfq.customerId,
        };
    }

    @ResolveField()
    requirement(@Parent() rfq: any) {
        return { item: rfq.item, qty: rfq.qty, eta: rfq.eta, memo: rfq.memo };
    }

    @ResolveField()
    quote(@Parent() rfq: any, @Ctx() ctx: any) {
        return this.rfqService.loadQuote(ctx, Number(rfq.id));
    }

    @ResolveField()
    sample(@Parent() rfq: any, @Ctx() ctx: any) {
        return this.rfqService.loadSample(ctx, Number(rfq.id));
    }

    @ResolveField()
    timeline(@Parent() rfq: any, @Ctx() ctx: any) {
        return this.rfqService.loadTimeline(ctx, rfq.code);
    }
}

@Resolver('StageEvent')
export class StageEventFieldResolver {
    // TODO(韩文待补)：数据库同时存 Kr/Cn，Kr 当前为中文占位；统一对外读取 Kr 字段
    @ResolveField()
    title(@Parent() event: any) {
        return event.titleKr || event.titleCn || '';
    }

    @ResolveField()
    desc(@Parent() event: any) {
        return event.descKr ?? event.descCn ?? null;
    }

    @ResolveField()
    time(@Parent() event: any) {
        return event.occurredAt;
    }
}

@Resolver('OnebridgeContent')
export class OnebridgeContentFieldResolver {
    @ResolveField()
    title(@Parent() entry: any, @Args('locale') locale: 'ko' | 'zh' = 'ko') {
        if (locale === 'zh') return entry.titleCn || entry.titleKr || '';
        return entry.titleKr || '';
    }

    @ResolveField()
    body(@Parent() entry: any, @Args('locale') locale: 'ko' | 'zh' = 'ko') {
        if (locale === 'zh') return entry.bodyCn ?? entry.bodyKr ?? null;
        return entry.bodyKr ?? null;
    }

    // ===== C 端字段别名（CT-09 columns/cases/logisticsChannels）=====

    @ResolveField()
    type(@Parent() entry: any) {
        return entry.contentType;
    }

    @ResolveField()
    krTitle(@Parent() entry: any) {
        return entry.titleKr ?? '';
    }

    @ResolveField()
    cnTitle(@Parent() entry: any) {
        return entry.titleCn ?? null;
    }

    @ResolveField()
    en(@Parent() entry: any) {
        return entry.titleEn ?? null;
    }

    @ResolveField()
    points(@Parent() entry: any) {
        return (entry.payload as any)?.points ?? null;
    }
}

@Resolver('ServiceChannel')
export class ServiceChannelFieldResolver {
    // C 端 serviceChannels 查询字段名（CT-09）→ 频道 struct list 字段别名
    @ResolveField()
    key(@Parent() item: any) {
        return item.key ?? item.needType ?? null;
    }

    @ResolveField()
    no(@Parent() item: any) {
        return item.no ?? null;
    }

    @ResolveField()
    kr(@Parent() item: any) {
        return item.nameKr ?? null;
    }

    @ResolveField()
    cn(@Parent() item: any) {
        return item.nameCn ?? null;
    }

    @ResolveField()
    en(@Parent() item: any) {
        return item.nameEn ?? null;
    }

    @ResolveField()
    headline(@Parent() item: any) {
        return item.headlineKr ?? null;
    }

    @ResolveField()
    intro(@Parent() item: any) {
        return item.introKr ?? null;
    }
}

/** 清关记录：C 端字段别名 + 时间轴（admin 列表同用） */
@Resolver('CustomsRecord')
export class CustomsRecordFieldResolver {
    constructor(private orderSummaryService: OnebridgeOrderSummaryService) {}

    @ResolveField()
    customsDeclaredAt(@Parent() record: any) {
        return record.declaredAt ?? null;
    }

    @ResolveField()
    customsClearedAt(@Parent() record: any) {
        return record.clearedAt ?? null;
    }

    @ResolveField()
    customsNote(@Parent() record: any) {
        return record.note ?? null;
    }

    @ResolveField()
    customsDocs(@Parent() record: any) {
        return record.docs ?? null;
    }

    @ResolveField()
    timeline(@Parent() record: any, @Ctx() ctx: any) {
        return this.orderSummaryService.timeline(ctx, record.orderCode);
    }
}

@Resolver()
export class OnebridgeShopResolver {
    constructor(
        private rfqService: OnebridgeRfqService,
        private contentService: OnebridgeContentService,
        private inspectionService: OnebridgeInspectionService,
        private customsService: OnebridgeCustomsService,
        private orderSummaryService: OnebridgeOrderSummaryService,
    ) {}

    @Mutation()
    @Allow(Permission.Public)
    submitRfq(@Ctx() ctx: any, @Args('input') input: any) {
        return this.rfqService.submitRfq(ctx, input);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myRfqs(@Ctx() ctx: any, @Args('options') options: any) {
        return this.rfqService.myRfqs(ctx, options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    rfq(@Ctx() ctx: any, @Args('code') code: string) {
        return this.rfqService.findRfqForCustomer(ctx, code);
    }

    @Query()
    @Allow(Permission.Public)
    columns(@Ctx() ctx: any, @Args('options') options: any) {
        return this.contentService.shopList(ctx, 'column', options);
    }

    @Query()
    @Allow(Permission.Public)
    column(@Ctx() ctx: any, @Args('slug') slug: string) {
        return this.contentService.shopFindBySlug(ctx, 'column', slug);
    }

    @Query()
    @Allow(Permission.Public)
    cases(@Ctx() ctx: any, @Args('options') options: any) {
        return this.contentService.shopList(ctx, 'case', options);
    }

    @Query()
    @Allow(Permission.Public)
    case(@Ctx() ctx: any, @Args('slug') slug: string) {
        return this.contentService.shopFindBySlug(ctx, 'case', slug);
    }

    @Query()
    @Allow(Permission.Public)
    logisticsChannels(@Ctx() ctx: any, @Args('options') options: any) {
        return this.contentService.shopList(ctx, 'logistics_channel', options);
    }

    @Query()
    @Allow(Permission.Public)
    logisticsChannel(@Ctx() ctx: any, @Args('slug') slug: string) {
        return this.contentService.shopFindBySlug(ctx, 'logistics_channel', slug);
    }

    @Query()
    @Allow(Permission.Public)
    siteContent(@Ctx() ctx: any, @Args('options') options: any) {
        return this.contentService.shopList(ctx, 'site_block', options);
    }

    @Query()
    @Allow(Permission.Public)
    serviceChannels(@Ctx() ctx: any) {
        return this.contentService.serviceChannels(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    inspectionReports(@Ctx() ctx: any, @Args() args: any) {
        return this.inspectionService.shopList(ctx, args);
    }

    @Query()
    @Allow(Permission.Authenticated)
    orderCustoms(@Ctx() ctx: any, @Args('orderCode') orderCode: string) {
        return this.customsService.shopFind(ctx, orderCode);
    }

    @Query()
    @Allow(Permission.Authenticated)
    async orderTimeline(@Ctx() ctx: any, @Args('orderCode') orderCode: string) {
        const summary = await this.orderSummaryService.summary(ctx, orderCode, true);
        return summary.timeline;
    }

    @Query()
    @Allow(Permission.Authenticated)
    orderTracks(@Ctx() ctx: any, @Args('orderCode') orderCode: string) {
        return this.orderSummaryService.orderTracks(ctx, orderCode);
    }

    @Query()
    @Allow(Permission.Authenticated)
    orderSummary(@Ctx() ctx: any, @Args('orderCode') orderCode: string) {
        return this.orderSummaryService.summary(ctx, orderCode, true);
    }
}
