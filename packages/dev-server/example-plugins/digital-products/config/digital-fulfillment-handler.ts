import { FulfillmentHandler, LanguageCode, OrderLine, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

let connection: TransactionalConnection;

/**
 * @description
 * This is a fulfillment handler for digital products which generates a download url
 * for each digital product in the order.
 */
export const digitalFulfillmentHandler = new FulfillmentHandler({
    code: 'digital-fulfillment',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Generates product keys for the digital download',
        },
    ],

    args: {},
    init: injector => {
        connection = injector.get(TransactionalConnection);
    },
    createFulfillment: async (ctx, orders, lines) => {
        const digitalDownloadUrls: string[] = [];

        const orderLines = await connection.getRepository(ctx, OrderLine).find({
            where: {
                id: In(lines.map(l => l.orderLineId)),
            },
            relations: {
                productVariant: true,
            },
        });
        for (const orderLine of orderLines) {
            if (orderLine.productVariant.customFields.isDigital) {
                // This is a digital product, so generate a download url
                const downloadUrl = await generateDownloadUrl(orderLine);
                digitalDownloadUrls.push(downloadUrl);
            }
        }
        return {
            method: 'Digital Fulfillment',
            trackingCode: 'DIGITAL',
            customFields: {
                downloadUrls: digitalDownloadUrls,
            },
        };
    },
});

function generateDownloadUrl(orderLine: OrderLine) {
    // This is a dummy function that would generate a download url for the given OrderLine
    // by interfacing with some external system that manages access to the digital product.
    // In this example, we just generate a random string.
    const downloadUrl = `https://example.com/download?key=${Math.random().toString(36).substring(7)}`;
    return Promise.resolve(downloadUrl);
}
