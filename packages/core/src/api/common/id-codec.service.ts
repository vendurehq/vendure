import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { InspectableJobQueueStrategy } from '../../config/job-queue/inspectable-job-queue-strategy';

import { IdCodec } from './id-codec';

@Injectable()
export class IdCodecService {
    private idCodec: IdCodec;
    /**
     * Whether job ids are encoded and decoded like entity ids. This is not the case
     * when the JobQueueStrategy generates its own job ids.
     * See {@link InspectableJobQueueStrategy.useEntityIdStrategyForJobIds}.
     */
    readonly transformJobIds: boolean;
    constructor(configService: ConfigService) {
        this.idCodec = new IdCodec(
            configService.entityOptions.entityIdStrategy ?? configService.entityIdStrategy,
        );
        const jobQueueStrategy = configService.jobQueueOptions.jobQueueStrategy as
            | Partial<InspectableJobQueueStrategy>
            | undefined;
        this.transformJobIds = jobQueueStrategy?.useEntityIdStrategyForJobIds !== false;
    }

    encode<T extends string | number | boolean | object | undefined>(target: T, transformKeys?: string[]): T {
        return this.idCodec.encode(target, transformKeys);
    }

    decode<T extends string | number | object | undefined>(target: T, transformKeys?: string[]): T {
        return this.idCodec.decode(target, transformKeys);
    }
}
