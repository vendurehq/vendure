import { describe, expect, it, vi } from 'vitest';

import { McpActiveOrderService } from './active-order.service';

describe('McpActiveOrderService', () => {
    describe('find', () => {
        it('returns the active order without loading its lines', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.find({} as never);

            expect(result).toBe(activeOrder);
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith({}, undefined);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });
    });

    describe('findOrCreate', () => {
        it('asks Vendure to create a cart when there is none, and loads no lines', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findOrCreate({} as never);

            expect(result).toBe(activeOrder);
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith({}, undefined, true);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });
    });

    describe('findWithLines', () => {
        it('returns undefined without fetching relations when no active order exists', async () => {
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(undefined),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findWithLines({} as never);

            expect(result).toBeUndefined();
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith({}, undefined);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });

        it('returns the active order re-fetched with line and product variant relations', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const orderWithRelations = { ...activeOrder, lines: [] };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn().mockResolvedValue(orderWithRelations),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findWithLines({} as never);

            expect(orderService.findOne).toHaveBeenCalledWith({}, '1', ['lines', 'lines.productVariant']);
            expect(result).toBe(orderWithRelations);
        });

        it('falls back to the active order when the relation fetch finds no order', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn().mockResolvedValue(undefined),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findWithLines({} as never);

            expect(result).toBe(activeOrder);
        });
    });
});
