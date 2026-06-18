import {
    ArgumentMetadata,
    ArgumentsHost,
    CallHandler,
    CanActivate,
    Catch,
    ExceptionFilter,
    ExecutionContext,
    HttpException,
    Injectable,
    NestInterceptor,
    PipeTransform,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { VendurePlugin } from '@vendure/core';
import { Observable } from 'rxjs';

@Injectable()
export class TestInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle();
    }
}

@Injectable()
export class TestPipe implements PipeTransform<any> {
    async transform(value: any, { metatype }: ArgumentMetadata) {
        return value;
    }
}

@Injectable()
export class TestGuard implements CanActivate {
    canActivate(context: ExecutionContext) {
        return true;
    }
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<any>();
        const request = ctx.getRequest<any>();
        const status = exception.getStatus();

        response.status(status).json({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}

/**
 * This plugin doesn't do anything other than attempt to register the global Nest providers
 * in order to test https://github.com/vendurehq/vendure/issues/837
 */
@VendurePlugin({
    providers: [
        {
            provide: APP_INTERCEPTOR,
            useClass: TestInterceptor,
        },
        {
            provide: APP_PIPE,
            useClass: TestPipe,
        },
        {
            provide: APP_GUARD,
            useClass: TestGuard,
        },
        {
            provide: APP_FILTER,
            useClass: HttpExceptionFilter,
        },
    ],
})
export class PluginWithGlobalProviders {}
