import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { ConfigService } from '../../config/config.service';
import { Zone } from '../../entity/zone/zone.entity';

import { ZoneService } from './zone.service';

describe('ZoneService cache', () => {
    it('delegates cache behavior and database loading to the configured strategy', async () => {
        const { service, repository, zoneCacheStrategy } = createService();
        const ctx = RequestContext.empty();

        const result = await service.getAllWithMembers(ctx);

        expect(result).toHaveLength(1);
        expect(zoneCacheStrategy.get).toHaveBeenCalledWith(ctx, expect.any(Function));
        expect(repository.find).toHaveBeenCalledOnce();
    });
});

function createService() {
    const repository = {
        find: vi.fn().mockResolvedValue([new Zone({ id: 1, name: 'Europe', members: [] })]),
    };
    const zoneCacheStrategy = {
        get: vi.fn((_ctx: RequestContext, load: () => Promise<Zone[]>) => load()),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
    };
    const connection = { getRepository: vi.fn().mockReturnValue(repository) };
    const configService = {
        entityOptions: { zoneCacheStrategy },
    } as unknown as ConfigService;
    const translator = { translate: vi.fn((value: unknown) => value) };
    const service = new ZoneService(
        connection as any,
        configService,
        {} as any,
        translator as any,
        {} as any,
        {} as any,
        {} as any,
    );
    return { service, repository, zoneCacheStrategy };
}
