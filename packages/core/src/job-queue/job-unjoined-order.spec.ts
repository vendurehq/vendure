import { describe, expect, it } from 'vitest';

import { Order } from '../entity/order/order.entity';

import { Job } from './job';

/**
 * Job data is made serializable by reading every prototype getter of a class instance. Some Order
 * getters (`discounts`, `totalQuantity`, `taxSummary`) throw when `lines` is not joined, so queueing
 * a job whose data holds such an Order throws. EmailPlugin.handleEvent() catches that error from
 * `jobQueue.add()` and logs it, and the email is never sent or retried.
 */
describe('Job data holding an Order loaded without lines', () => {
    it('can be queued', () => {
        const order = new Order({ id: 1, code: 'ABC123', subTotal: 1000, shipping: 0 });

        const createJob = () =>
            new Job({
                queueName: 'send-email',
                data: { type: 'order-day-moved', templateVars: { order } },
            });

        expect(createJob).not.toThrow();
    });
});
