// e:\code\vendure\packages\customer-service-plugin\src\customer-service-admin.resolver.ts
// 采用 schema-first 模式（与 after-sales-plugin 一致）：
// - SDL 字符串定义所有 GraphQL 类型（在 customer-service.plugin.ts 中）
// - resolver 用 @Query() / @Mutation() 不指定返回类型，返回值由 GraphQL 从 schema 推断
// - 不需要 @ObjectType / @Field 装饰器
// 原因：CsOrderDetail.afterSalesRequests 引用 AfterSalesRequest 实体，但该实体没有 @ObjectType 装饰器
// （after-sales-plugin 用纯 schema-first 模式）。为保持一致性和避免修改 after-sales-plugin，本插件也用 schema-first。
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, UserInputError } from '@vendure/core';

import { CustomerServicePermissions } from './constants';
import { CustomerServiceService } from './customer-service.service';

/**
 * @description
 * 客服 Admin API Resolver（schema-first 模式）。
 *
 * 权限映射：
 * - csAllOrders / csOrderDetail → ViewAllOrders
 * - csAfterSalesRequests / csAfterSalesRequestDetail / csApproveAfterSales / csRejectAfterSales / csConfirmReturnReceived / csProcessRefund → HandleAfterSales
 * - csExceptionOrders / csAddExceptionNote → HandleException
 *
 * 注意：权限名 ViewAllOrders/HandleAfterSales/HandleException 由 delivery-plugin 注册到 customPermissions，
 * 此处用 `'xxx' as Permission` 字符串字面量引用，不重复注册 PermissionDefinition。
 */
@Resolver()
export class CustomerServiceAdminResolver {
    constructor(private csService: CustomerServiceService) {}

    // ===== 订单查询 =====

    @Query()
    @Allow(CustomerServicePermissions.ViewAllOrders as Permission)
    async csAllOrders(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'state', type: () => String, nullable: true }) state?: string,
        @Args({ name: 'customerEmail', type: () => String, nullable: true }) customerEmail?: string,
        @Args({ name: 'startDate', type: () => String, nullable: true }) startDate?: string,
        @Args({ name: 'endDate', type: () => String, nullable: true }) endDate?: string,
        @Args({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 }) page?: number,
        @Args({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 }) pageSize?: number,
    ) {
        if (startDate && isNaN(new Date(startDate).getTime())) {
            throw new UserInputError('startDate 必须是合法日期');
        }
        if (endDate && isNaN(new Date(endDate).getTime())) {
            throw new UserInputError('endDate 必须是合法日期');
        }
        return this.csService.findAllOrders(ctx, {
            state,
            customerEmail,
            startDate,
            endDate,
            page,
            pageSize,
        });
    }

    @Query()
    @Allow(CustomerServicePermissions.ViewAllOrders as Permission)
    async csOrderDetail(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ) {
        return this.csService.findOrderDetail(ctx, id);
    }

    // ===== 售后处理 =====
    // 售后 query/mutation 返回 AfterSalesRequest 实体（schema 中为 AfterSalesRequestAdmin 类型，
    // GraphQL 通过字段名匹配自动序列化实体，无需 @ObjectType 装饰器）

    @Query()
    @Allow(CustomerServicePermissions.HandleAfterSales as Permission)
    async csAfterSalesRequests(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'state', type: () => String, nullable: true }) state?: string,
        @Args({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 }) page?: number,
        @Args({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 }) pageSize?: number,
    ) {
        return this.csService.findAfterSalesRequests(ctx, { state, page, pageSize });
    }

    @Query()
    @Allow(CustomerServicePermissions.HandleAfterSales as Permission)
    async csAfterSalesRequestDetail(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ) {
        return this.csService.findOneAfterSalesRequest(ctx, id);
    }

    @Mutation()
    @Allow(CustomerServicePermissions.HandleAfterSales as Permission)
    async csApproveAfterSales(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ) {
        return this.csService.approveAfterSales(ctx, id);
    }

    @Mutation()
    @Allow(CustomerServicePermissions.HandleAfterSales as Permission)
    async csRejectAfterSales(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('reason') reason: string,
    ) {
        return this.csService.rejectAfterSales(ctx, id, reason);
    }

    @Mutation()
    @Allow(CustomerServicePermissions.HandleAfterSales as Permission)
    async csConfirmReturnReceived(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ) {
        return this.csService.confirmReturnReceived(ctx, id);
    }

    @Mutation()
    @Allow(CustomerServicePermissions.HandleAfterSales as Permission)
    async csProcessRefund(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ) {
        return this.csService.processRefund(ctx, id);
    }

    // ===== 异常跟进 =====

    @Query()
    @Allow(CustomerServicePermissions.HandleException as Permission)
    async csExceptionOrders(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'exceptionType', type: () => String, nullable: true }) exceptionType?: string,
        @Args({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 }) page?: number,
        @Args({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 }) pageSize?: number,
    ) {
        return this.csService.findExceptionOrders(ctx, { exceptionType, page, pageSize });
    }

    @Mutation()
    @Allow(CustomerServicePermissions.HandleException as Permission)
    async csAddExceptionNote(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('note') note: string,
    ) {
        const order = await this.csService.addExceptionNote(ctx, orderId, note);
        const cf = (order.customFields ?? {}) as any;
        return {
            order,
            exceptionInfo: {
                deliveryStatus: cf.deliveryStatus,
                exceptionType: cf.exceptionType,
                exceptionNote: cf.exceptionNote,
                exceptionPhotos: cf.exceptionPhotos ?? [],
                deliveryStaffId: cf.deliveryStaffId,
            },
            csNotes: cf.csNotes ?? [],
        };
    }
}
