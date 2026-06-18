import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import { ErrorResult as AdminErrorResult } from '../../common/error/generated-graphql-admin-errors';
import { ErrorResult as ShopErrorResult } from '../../common/error/generated-graphql-shop-errors';
import { I18nService } from '../../i18n/i18n.service';
import { parseContext } from '../common/parse-context';

/**
 * @description
 * Translates any top-level ErrorResult message
 */
@Injectable()
export class TranslateErrorResultInterceptor implements NestInterceptor {
    constructor(private i18nService: I18nService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const { isGraphQL, req } = parseContext(context);
        return next.handle().pipe(
            switchMap(result => Promise.resolve(result)),
            map(result => {
                if (Array.isArray(result)) {
                    for (const item of result) {
                        this.translateResult(req, item);
                    }
                } else {
                    this.translateResult(req, result);
                }
                return result;
            }),
        );
    }

    private translateResult(req: any, result: unknown) {
        if (result instanceof AdminErrorResult || result instanceof ShopErrorResult) {
            this.i18nService.translateErrorResult(req, result as any);
        }
    }
}
