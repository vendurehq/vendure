import { Test } from '@nestjs/testing';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { ConfigService } from '../../../config/config.service';
import { MockConfigService } from '../../../config/config.service.mock';
import { Channel } from '../../../entity/channel/channel.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { ChannelService } from '../../services/channel.service';
import { CustomerService } from '../../services/customer.service';

import { CustomerChannelAssignmentService } from './customer-channel-assignment.service';

const USER_ID = 'T_10';
const CHANNEL_ID = 'T_2';
const NON_DEFAULT_CODE = 'gated-channel';

function createCtx(channelCode: string, hasUser = true): RequestContext {
    const channel = new Channel({ code: channelCode, id: CHANNEL_ID });
    return new RequestContext({
        apiType: 'shop',
        channel,
        session: hasUser ? ({ user: { id: USER_ID } } as any) : undefined,
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
    });
}

const customer = { id: 'T_5' } as Customer;

describe('CustomerChannelAssignmentService', () => {
    let service: CustomerChannelAssignmentService;
    let configService: MockConfigService;
    let findOneByUserId: ReturnType<typeof vi.fn>;
    let assignToChannels: ReturnType<typeof vi.fn>;
    let canAssignCustomerToChannel: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        findOneByUserId = vi.fn();
        assignToChannels = vi.fn().mockResolvedValue(undefined);
        canAssignCustomerToChannel = vi.fn().mockReturnValue(true);

        const module = await Test.createTestingModule({
            providers: [
                CustomerChannelAssignmentService,
                { provide: ConfigService, useClass: MockConfigService },
                { provide: CustomerService, useValue: { findOneByUserId } },
                { provide: ChannelService, useValue: { assignToChannels } },
            ],
        }).compile();

        service = module.get(CustomerChannelAssignmentService);
        configService = module.get<ConfigService, MockConfigService>(ConfigService);
        configService.authOptions = {
            disableAuth: false,
            customerChannelAssignmentStrategy: {
                canAssignCustomerToChannel,
            },
        } as any;
    });

    /** member-filtered call (filterOnChannel=true) returns the member; the unfiltered call the entity. */
    function mockCustomer(opts: { isMember: boolean; exists: boolean }) {
        findOneByUserId.mockImplementation((_ctx: RequestContext, _userId: ID, filterOnChannel = true) => {
            if (filterOnChannel) {
                return Promise.resolve(opts.isMember ? customer : undefined);
            }
            return Promise.resolve(opts.exists ? customer : undefined);
        });
    }

    describe('non-default channel', () => {
        it('assigns a non-member when the strategy allows assignment', async () => {
            mockCustomer({ isMember: false, exists: true });

            await service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE));

            expect(canAssignCustomerToChannel).toHaveBeenCalledWith(expect.anything(), customer, CHANNEL_ID);
            expect(assignToChannels).toHaveBeenCalledWith(expect.anything(), Customer, customer.id, [
                CHANNEL_ID,
            ]);
        });

        it('allows a non-member without assigning when assignment is suppressed', async () => {
            mockCustomer({ isMember: false, exists: true });
            canAssignCustomerToChannel.mockReturnValue(false);

            await service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE));

            expect(assignToChannels).not.toHaveBeenCalled();
        });

        it('short-circuits an existing member without consulting the strategy', async () => {
            mockCustomer({ isMember: true, exists: true });

            await service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE));

            expect(canAssignCustomerToChannel).not.toHaveBeenCalled();
            expect(assignToChannels).not.toHaveBeenCalled();
        });

        it('skips an authenticated user that has no Customer record', async () => {
            mockCustomer({ isMember: false, exists: false });

            await service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE));

            expect(canAssignCustomerToChannel).not.toHaveBeenCalled();
            expect(assignToChannels).not.toHaveBeenCalled();
        });
    });

    describe('ungated path', () => {
        it('assigns on the default channel without consulting the strategy', async () => {
            mockCustomer({ isMember: false, exists: true });

            await service.tryAssignToActiveChannel(createCtx(DEFAULT_CHANNEL_CODE));

            expect(assignToChannels).toHaveBeenCalledWith(expect.anything(), Customer, customer.id, [
                CHANNEL_ID,
            ]);
            expect(canAssignCustomerToChannel).not.toHaveBeenCalled();
        });

        it('assigns under disableAuth without consulting the strategy', async () => {
            mockCustomer({ isMember: false, exists: true });
            (configService.authOptions as any).disableAuth = true;

            await service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE));

            expect(assignToChannels).toHaveBeenCalled();
            expect(canAssignCustomerToChannel).not.toHaveBeenCalled();
        });

        it('skips assignment on the default channel when the user has no Customer record', async () => {
            mockCustomer({ isMember: false, exists: false });

            await service.tryAssignToActiveChannel(createCtx(DEFAULT_CHANNEL_CODE));

            expect(assignToChannels).not.toHaveBeenCalled();
        });
    });

    describe('assign write', () => {
        it('swallows a duplicate-key error from a concurrent assign (issue #834)', async () => {
            mockCustomer({ isMember: false, exists: true });
            assignToChannels.mockRejectedValue({ code: '23505' });

            await expect(
                service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE)),
            ).resolves.toBeUndefined();
        });

        it('rethrows a non-duplicate error from the assign', async () => {
            mockCustomer({ isMember: false, exists: true });
            assignToChannels.mockRejectedValue({ code: 'SOME_OTHER_ERROR' });

            await expect(service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE))).rejects.toEqual({
                code: 'SOME_OTHER_ERROR',
            });
        });
    });

    it('does nothing when there is no authenticated user', async () => {
        await service.tryAssignToActiveChannel(createCtx(NON_DEFAULT_CODE, false));

        expect(findOneByUserId).not.toHaveBeenCalled();
    });
});
