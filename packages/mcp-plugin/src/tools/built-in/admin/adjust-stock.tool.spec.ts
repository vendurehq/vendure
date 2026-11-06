import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { AdjustStockTool } from './adjust-stock.tool';

const serializer = { stockLevel: (level: unknown) => level } as any;

type Levels = Array<{ stockLocationId: number; stockOnHand: number }>;

function build(location: unknown, levels: Levels, secondLockedLevels?: Levels) {
    const update = vi.fn().mockResolvedValue([]);
    const productVariantService = { update } as any;
    const getLockedStockLevelsForVariant = vi.fn().mockResolvedValue(levels);
    if (secondLockedLevels) {
        getLockedStockLevelsForVariant
            .mockResolvedValueOnce(levels)
            .mockResolvedValueOnce(secondLockedLevels);
    }
    const stockLevelService = {
        getLockedStockLevelsForVariant,
        // Only the response is built from the unlocked read, so it never holds the figure the delta is
        // added to.
        getStockLevelsForVariant: () => Promise.resolve([]),
    } as any;
    const stockLocationService = { findOne: () => Promise.resolve(location) } as any;
    const tool = new AdjustStockTool(
        productVariantService,
        stockLevelService,
        stockLocationService,
        serializer,
    );
    return { tool, update };
}

describe('AdjustStockTool', () => {
    it('refuses a location the active channel cannot see, and writes nothing', async () => {
        const { tool, update } = build(undefined, []);

        await expect(
            tool.execute({} as any, { variantId: 1, locationId: 99999, delta: -5 }),
        ).rejects.toThrowError(UserInputError);
        expect(update).not.toHaveBeenCalled();
    });

    it('adds the delta to the stock already held at the location', async () => {
        const { tool, update } = build({ id: 1 }, [{ stockLocationId: 1, stockOnHand: 10 }]);

        await tool.execute({} as any, { variantId: 1, locationId: 1, delta: 5 });

        expect(update).toHaveBeenCalledWith({}, [
            { id: 1, stockLevels: [{ stockLocationId: 1, stockOnHand: 15 }] },
        ]);
    });

    it('reads the stock again when the location had no row when it was first locked', async () => {
        const { tool, update } = build({ id: 1 }, [], [{ stockLocationId: 1, stockOnHand: 3 }]);

        await tool.execute({} as any, { variantId: 1, locationId: 1, delta: 1 });

        expect(update).toHaveBeenCalledWith({}, [
            { id: 1, stockLevels: [{ stockLocationId: 1, stockOnHand: 4 }] },
        ]);
    });
});
