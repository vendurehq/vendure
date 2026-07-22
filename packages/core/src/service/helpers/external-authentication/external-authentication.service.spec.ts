import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { EntityNotFoundError } from '../../../common/error/errors';
import { Administrator } from '../../../entity/administrator/administrator.entity';
import { AdministratorService } from '../../services/administrator.service';

import { ExternalAuthenticationService } from './external-authentication.service';

describe('ExternalAuthenticationService', () => {
    const ctx = RequestContext.empty();
    const avatar = {
        filename: 'provider-profile.png',
        mimetype: 'image/png',
        createReadStream: () => Readable.from([Buffer.from('image')]),
    };

    function createService(administratorService: Partial<AdministratorService>) {
        return new ExternalAuthenticationService(
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
            administratorService as AdministratorService,
            undefined as any,
        );
    }

    it('sets an avatar using the authenticated User id', async () => {
        const administrator = new Administrator({ id: 42 });
        const administratorService = {
            findOneByUserId: vi.fn().mockResolvedValue(administrator),
            setAvatar: vi.fn().mockResolvedValue(administrator),
        };
        const service = createService(administratorService);

        await expect(service.setAdministratorAvatar(ctx, 7, avatar)).resolves.toBe(administrator);
        expect(administratorService.findOneByUserId).toHaveBeenCalledWith(ctx, 7);
        expect(administratorService.setAvatar).toHaveBeenCalledWith(ctx, 42, avatar);
    });

    it('fails when the User is not associated with an Administrator', async () => {
        const service = createService({
            findOneByUserId: vi.fn().mockResolvedValue(undefined),
        });

        await expect(service.setAdministratorAvatar(ctx, 7, avatar)).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});
