import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { GqlExecutionContext } from '../../common/nestjs-graphql-internals';

import { IdArgumentDecoder } from '../common/id-argument-decoder';
import { parseContext } from '../common/parse-context';

export const ID_CODEC_TRANSFORM_KEYS = 'idCodecTransformKeys';

/**
 * This interceptor automatically decodes incoming requests so that any
 * ID values are transformed correctly as per the configured EntityIdStrategy.
 *
 * ID values are defined as properties with the name "id", or properties with names matching any
 * arguments passed to the {@link Decode} decorator.
 */
@Injectable()
export class IdInterceptor implements NestInterceptor {
    constructor(private idArgumentDecoder: IdArgumentDecoder) {}

    intercept(context: ExecutionContext, next: CallHandler<any>): Observable<any> {
        const { isGraphQL, info } = parseContext(context);
        if (isGraphQL && info) {
            const args = GqlExecutionContext.create(context).getArgs();
            this.idArgumentDecoder.decodeInPlace(info, args);
        }
        return next.handle();
    }
}
