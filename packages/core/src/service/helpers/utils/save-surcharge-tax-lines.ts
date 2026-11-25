import { RequestContext } from '../../../api/common/request-context';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Surcharge } from '../../../entity/surcharge/surcharge.entity';

/**
 * @description
 * Takes a snapshot of the TaxLines of the given Surcharges, and returns a function that saves the
 * TaxLines of those that changed since. The OrderCalculator can give a Surcharge absolute tax
 * amounts from the TaxLineCalculationStrategy, and those have to be stored with the Surcharge,
 * which is not saved together with the Order.
 */
export function trackSurchargeTaxLines(surcharges: Surcharge[] | undefined) {
    const before = new Map(
        (surcharges ?? []).map(surcharge => [surcharge, JSON.stringify(surcharge.taxLines)]),
    );
    return async (ctx: RequestContext, connection: TransactionalConnection) => {
        for (const [surcharge, taxLines] of before) {
            if (surcharge.id != null && JSON.stringify(surcharge.taxLines) !== taxLines) {
                await connection
                    .getRepository(ctx, Surcharge)
                    .update(surcharge.id, { taxLines: surcharge.taxLines });
            }
        }
    };
}
