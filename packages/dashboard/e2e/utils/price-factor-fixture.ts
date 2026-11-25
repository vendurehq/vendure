import { type Locator, type Page } from '@playwright/test';

import { closePopup } from './base-ui-popups.js';
import { VendureAdminClient } from './vendure-admin-client.js';

/**
 * Creates a second channel and a product with one variant priced at 1000, for testing the
 * price conversion factor of the "Assign to channel" dialog. Call `cleanup()` in a `finally`.
 */
export async function createPriceFactorFixture(page: Page, label: string) {
    const suffix = `${label}-${Date.now()}`;
    const channelCode = `e2e-price-factor-${suffix}`;
    const productName = `Price Factor ${suffix}`;
    const client = new VendureAdminClient(page);
    await client.login();
    const zones = await client.gql(`query { zones(options: { take: 1 }) { items { id } } }`);
    const zoneId = zones.zones.items[0].id as string;
    let channelId: string | undefined;
    let productId: string | undefined;

    const cleanup = async () => {
        if (productId) {
            await client
                .gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id: productId })
                .catch(() => undefined);
        }
        if (channelId) {
            await client
                .gql(`mutation ($id: ID!) { deleteChannel(id: $id) { result } }`, { id: channelId })
                .catch(() => undefined);
        }
    };

    try {
        const { createChannel } = await client.gql(
            `mutation ($input: CreateChannelInput!) { createChannel(input: $input) { ... on Channel { id } } }`,
            {
                input: {
                    code: channelCode,
                    token: channelCode,
                    defaultLanguageCode: 'en',
                    pricesIncludeTax: false,
                    defaultCurrencyCode: 'USD',
                    defaultTaxZoneId: zoneId,
                    defaultShippingZoneId: zoneId,
                },
            },
        );
        channelId = createChannel.id;
        const { createProduct } = await client.gql(
            `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
            {
                input: {
                    translations: [
                        {
                            languageCode: 'en',
                            name: productName,
                            slug: `price-factor-${suffix}`,
                            description: '',
                        },
                    ],
                },
            },
        );
        productId = createProduct.id;
        await client.gql(
            `mutation ($input: [CreateProductVariantInput!]!) { createProductVariants(input: $input) { id } }`,
            {
                input: [
                    {
                        productId: createProduct.id,
                        sku: `PF-${suffix}`,
                        price: 1000,
                        translations: [{ languageCode: 'en', name: productName }],
                    },
                ],
            },
        );
    } catch (e) {
        await cleanup();
        throw e;
    }

    /** The price of the product's variant in the new channel, or undefined if not assigned. */
    const priceInChannel = async () => {
        const result = await client.gql(
            `query ($id: ID!) { product(id: $id) { variants { price } } }`,
            { id: productId },
            { 'vendure-token': channelCode },
        );
        return result.product?.variants?.[0]?.price as number | undefined;
    };

    return { channelCode, productName, productId: productId as string, priceInChannel, cleanup };
}

/** Selects `channelCode` in the open "Assign to channel" dialog and returns the dialog. */
export async function selectAssignChannel(page: Page, channelCode: string): Promise<Locator> {
    const dialog = page.getByRole('dialog');
    const channels = dialog.getByRole('combobox');
    await channels.click();
    await page.getByRole('option', { name: channelCode }).click();
    await closePopup(channels);
    return dialog;
}

/** Types `text` into the cleared price conversion factor field, one key at a time. */
export async function typePriceFactor(dialog: Locator, text: string) {
    const factor = dialog.getByRole('spinbutton');
    await factor.clear();
    await factor.pressSequentially(text);
    return factor;
}
