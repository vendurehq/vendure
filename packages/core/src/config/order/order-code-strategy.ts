import { RequestContext } from '../../api/common/request-context';
import { generatePublicId } from '../../common/generate-public-id';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * The OrderCodeStrategy determines how Order codes are generated.
 * A custom strategy can be defined which e.g. integrates with an
 * existing system to generate a code:
 *
 * :::info
 *
 * This is configured via the `orderOptions.orderCodeStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @example
 * ```ts
 * class MyOrderCodeStrategy implements OrderCodeStrategy {
 *   // Some imaginary service which calls out to an existing external
 *   // order management system.
 *   private mgmtService: ExternalOrderManagementService;
 *
 *   init(injector: Injector) {
 *     this.mgmtService = injector.get(ExternalOrderManagementService);
 *   }
 *
 *   async generate(ctx: RequestContext) {
 *     const result = await this.mgmtService.getAvailableOrderParams();
 *     return result.code;
 *   }
 * }
 * ```
 *
 * @docsCategory orders
 * @docsPage OrderCodeStrategy
 */
export interface OrderCodeStrategy extends InjectableStrategy {
    /**
     * @description
     * Generates the order code.
     */
    generate(ctx: RequestContext): string | Promise<string>;
}

/**
 * @description
 * The default OrderCodeStrategy generates a random string consisting
 * of 16 uppercase letters and numbers.
 *
 * @docsCategory orders
 * @docsPage OrderCodeStrategy
 */
export class DefaultOrderCodeStrategy implements OrderCodeStrategy {
    generate(ctx: RequestContext): string {
        return generatePublicId();
    }
}
