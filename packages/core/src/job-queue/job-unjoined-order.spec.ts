import { describe, expect, it } from 'vitest';

import { Order } from '../entity/order/order.entity';

import { Job } from './job';

/**
 * Job data is made serializable by reading every prototype getter of a class instance. Some Order
 * getters (`discounts`, `totalQuantity`, `taxSummary`) throw when `lines` is not joined. Those
 * getters must be skipped, otherwise `jobQueue.add()` throws and EmailPlugin drops the email.
 */
// OSS-940 — EmailPlugin drops an email whose event carries an Order loaded without lines
describe('Job data holding an Order loaded without lines', () => {
    it('can be queued', () => {
        const order = new Order({ id: 1, code: 'ABC123', subTotal: 1000, shipping: 0 });

        const job = new Job({
            queueName: 'send-email',
            data: { templateVars: { order } },
        });

        const serializedOrder = (job.data as any).templateVars.order;
        expect(serializedOrder).toMatchObject({ id: 1, code: 'ABC123', subTotal: 1000, shipping: 0 });
        expect(serializedOrder).not.toHaveProperty('totalQuantity');
        expect(serializedOrder).not.toHaveProperty('discounts');
        expect(serializedOrder).not.toHaveProperty('taxSummary');
    });
});
