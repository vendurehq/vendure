import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext, SerializedRequestContext } from '../../../api/common/request-context';
import { Channel } from '../../../entity/channel/channel.entity';

/**
 * @description
 * This is used during search index creation to allow us to use a single
 * RequestContext, but mutate the Channel. In this way, we can take
 * full advantage of the RequestContextCacheService, and _massively_ cut
 * down on the number of DB calls being made during indexing.
 */
export class MutableRequestContext extends RequestContext {
    constructor(options: ConstructorParameters<typeof RequestContext>[0]) {
        super(options);
    }
    private mutatedChannel: Channel | undefined;

    setChannel(channel: Channel) {
        this.mutatedChannel = channel;
    }

    get channel(): Channel {
        return this.mutatedChannel ?? super.channel;
    }

    get channelId(): ID {
        return this.mutatedChannel?.id ?? super.channelId;
    }

    get currencyCode(): CurrencyCode {
        return this.mutatedChannel?.defaultCurrencyCode ?? super.currencyCode;
    }

    static deserialize(ctxObject: SerializedRequestContext): MutableRequestContext {
        return new MutableRequestContext({
            req: ctxObject._req,
            apiType: ctxObject._apiType,
            channel: new Channel(ctxObject._channel),
            session: {
                ...ctxObject._session,
                expires: ctxObject._session?.expires && new Date(ctxObject._session.expires),
            },
            languageCode: ctxObject._languageCode,
            isAuthorized: ctxObject._isAuthorized,
            authorizedAsOwnerOnly: ctxObject._authorizedAsOwnerOnly,
        });
    }
}
