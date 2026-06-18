import { fail } from 'assert';

/**
 * @description
 * Convenience method for creating an {@link ErrorResultGuard}. Takes a predicate function which
 * tests whether the input is considered successful (true) or an error result (false).
 *
 * Note that the resulting variable must _still_ be type annotated in order for the TypeScript
 * type inference to work as expected:
 *
 * @example
 * ```ts
 * const orderResultGuard: ErrorResultGuard<AddItemToOrderResult>
 *   = createErrorResultGuard(order => !!order.lines);
 * ```
 * @docsCategory testing
 */
export function createErrorResultGuard<T>(testFn: (input: T) => boolean): ErrorResultGuard<T> {
    return new ErrorResultGuard<T>(testFn);
}

/**
 * @description
 * A utility class which is used to assert the success of an operation
 * which returns a union type of `SuccessType | ErrorResponse [ | ErrorResponse ]`.
 * The methods of this class are used to:
 * 1. assert that the result is a success or error case
 * 2. narrow the type so that TypeScript can correctly infer the properties of the result.
 *
 * @example
 * ```ts
 * const orderResultGuard: ErrorResultGuard<AddItemToOrderResult>
 *   = createErrorResultGuard(order => !!order.lines);
 *
 * it('errors when quantity is negative', async () => {
 *    const { addItemToOrder } = await shopClient.query<AddItemToOrder.Query, AddItemToOrder.Mutation>(ADD_ITEM_TO_ORDER, {
 *      productVariantId: 42, quantity: -1,
 *    });
 *
 *    // The test will fail
 *    orderResultGuard.assertErrorResult(addItemToOrder);
 *
 *    // the type of `addItemToOrder` has now been
 *    // narrowed to only include the ErrorResult types.
 *    expect(addItemToOrder.errorCode).toBe(ErrorCode.NegativeQuantityError);
 * }
 * ```
 * @docsCategory testing
 */
export class ErrorResultGuard<T> {
    constructor(private testFn: (input: T) => boolean) {}

    /**
     * @description
     * A type guard which returns `true` if the input passes the `testFn` predicate.
     */
    isSuccess(input: T | any): input is T {
        return this.testFn(input as T);
    }

    /**
     * @description
     * Asserts (using the testing library's `fail()` function) that the input is
     * successful, i.e. it passes the `testFn`.
     */
    assertSuccess<R>(input: T | R): asserts input is T {
        if (!this.isSuccess(input)) {
            fail(`Unexpected error: ${JSON.stringify(input)}`);
        }
    }

    /**
     * @description
     * Asserts (using the testing library's `fail()` function) that the input is
     * not successful, i.e. it does not pass the `testFn`.
     */
    assertErrorResult<R>(input: T | R): asserts input is R {
        if (this.isSuccess(input)) {
            fail('Should have errored');
        }
    }
}
