import { ArgumentsHost } from '@nestjs/common';

import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Job } from '../../job-queue/job';

/**
 * @description
 * This strategy defines logic for handling errors thrown during on both the server
 * and the worker. It can be used for additional logging & monitoring, or for sending error
 * reports to external services.
 *
 * :::info
 *
 * This is configured via the `systemOptions.errorHandlers` property of
 * your VendureConfig.
 *
 * :::
 *
 * @example
 * ```ts
 * import { ArgumentsHost, ExecutionContext } from '\@nestjs/common';
 * import { GqlContextType, GqlExecutionContext } from '\@nestjs/graphql';
 * import { ErrorHandlerStrategy, I18nError, Injector, Job, LogLevel } from '\@vendure/core';
 *
 * import { MonitoringService } from './monitoring.service';
 *
 * export class CustomErrorHandlerStrategy implements ErrorHandlerStrategy {
 *     private monitoringService: MonitoringService;
 *
 *     init(injector: Injector) {
 *         this.monitoringService = injector.get(MonitoringService);
 *     }
 *
 *     handleServerError(error: Error, { host }: { host: ArgumentsHost }) {
 *          const errorContext: any = {};
 *          if (host?.getType<GqlContextType>() === 'graphql') {
 *              const gqlContext = GqlExecutionContext.create(host as ExecutionContext);
 *              const info = gqlContext.getInfo();
 *              errorContext.graphQlInfo = {
 *                  fieldName: info.fieldName,
 *                  path: info.path,
 *              };
 *          }
 *          this.monitoringService.captureException(error, errorContext);
 *     }
 *
 *     handleWorkerError(error: Error, { job }: { job: Job }) {
 *         const errorContext = {
 *             queueName: job.queueName,
 *             jobId: job.id,
 *         };
 *         this.monitoringService.captureException(error, errorContext);
 *     }
 * }
 * ```
 *
 * @since 2.2.0
 * @docsCategory Errors
 */
export interface ErrorHandlerStrategy extends InjectableStrategy {
    /**
     * @description
     * This method will be invoked for any error thrown during the execution of the
     * server.
     */
    handleServerError(exception: Error, context: { host: ArgumentsHost }): void | Promise<void>;

    /**
     * @description
     * This method will be invoked for any error thrown during the execution of a
     * job on the worker.
     */
    handleWorkerError(exception: Error, context: { job: Job }): void | Promise<void>;
}
