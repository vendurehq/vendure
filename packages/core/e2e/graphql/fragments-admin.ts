import { graphql } from './graphql-admin';

export const administratorFragment = graphql(`
    fragment Administrator on Administrator {
        id
        firstName
        lastName
        emailAddress
        user {
            id
            identifier
            lastLogin
            roles {
                id
                code
                description
                permissions
            }
        }
    }
`);

export const assetFragment = graphql(`
    fragment Asset on Asset {
        id
        name
        fileSize
        mimeType
        type
        preview
        source
    }
`);

export const productVariantFragment = graphql(
    `
        fragment ProductVariant on ProductVariant {
            id
            createdAt
            updatedAt
            enabled
            languageCode
            name
            currencyCode
            price
            priceWithTax
            prices {
                currencyCode
                price
            }
            stockOnHand
            trackInventory
            taxRateApplied {
                id
                name
                value
            }
            taxCategory {
                id
                name
            }
            sku
            options {
                id
                code
                languageCode
                groupId
                name
            }
            facetValues {
                id
                code
                name
                facet {
                    id
                    name
                }
            }
            featuredAsset {
                ...Asset
            }
            assets {
                ...Asset
            }
            translations {
                id
                languageCode
                name
            }
            channels {
                id
                code
            }
        }
    `,
    [assetFragment],
);

export const productWithVariantsFragment = graphql(
    `
        fragment ProductWithVariants on Product {
            id
            enabled
            languageCode
            name
            slug
            description
            featuredAsset {
                ...Asset
            }
            assets {
                ...Asset
            }
            translations {
                languageCode
                name
                slug
                description
            }
            optionGroups {
                id
                languageCode
                code
                name
            }
            variants {
                ...ProductVariant
            }
            facetValues {
                id
                code
                name
                facet {
                    id
                    name
                }
            }
            channels {
                id
                code
            }
        }
    `,
    [productVariantFragment, assetFragment],
);

export const roleFragment = graphql(`
    fragment Role on Role {
        id
        code
        description
        permissions
        channels {
            id
            code
            token
        }
    }
`);

export const configurableFragment = graphql(`
    fragment ConfigurableOperation on ConfigurableOperation {
        args {
            name
            value
        }
        code
    }
`);

export const collectionFragment = graphql(
    `
        fragment Collection on Collection {
            id
            name
            slug
            description
            isPrivate
            languageCode
            featuredAsset {
                ...Asset
            }
            assets {
                ...Asset
            }
            filters {
                ...ConfigurableOperation
            }
            translations {
                id
                languageCode
                name
                slug
                description
            }
            parent {
                id
                name
            }
            children {
                id
                name
                position
            }
        }
    `,
    [assetFragment, configurableFragment],
);

export const facetValueFragment = graphql(`
    fragment FacetValue on FacetValue {
        id
        languageCode
        code
        name
        translations {
            id
            languageCode
            name
        }
        facet {
            id
            name
        }
    }
`);

export const facetWithValuesFragment = graphql(
    `
        fragment FacetWithValues on Facet {
            id
            languageCode
            isPrivate
            code
            name
            translations {
                id
                languageCode
                name
            }
            values {
                ...FacetValue
            }
        }
    `,
    [facetValueFragment],
);

export const countryFragment = graphql(`
    fragment Country on Region {
        id
        code
        name
        enabled
        translations {
            id
            languageCode
            name
        }
    }
`);

export const addressFragment = graphql(`
    fragment Address on Address {
        id
        fullName
        company
        streetLine1
        streetLine2
        city
        province
        postalCode
        country {
            id
            code
            name
        }
        phoneNumber
        defaultShippingAddress
        defaultBillingAddress
    }
`);

export const customerFragment = graphql(
    `
        fragment Customer on Customer {
            id
            title
            firstName
            lastName
            phoneNumber
            emailAddress
            user {
                id
                identifier
                verified
                lastLogin
            }
            addresses {
                ...Address
            }
        }
    `,
    [addressFragment],
);

export const adjustmentFragment = graphql(`
    fragment Adjustment on Adjustment {
        adjustmentSource
        amount
        description
        type
    }
`);

export const shippingAddressFragment = graphql(`
    fragment ShippingAddress on OrderAddress {
        fullName
        company
        streetLine1
        streetLine2
        city
        province
        postalCode
        country
        countryCode
        phoneNumber
    }
`);

export const orderFragment = graphql(`
    fragment Order on Order {
        id
        createdAt
        updatedAt
        code
        active
        state
        total
        totalWithTax
        totalQuantity
        currencyCode
        customer {
            id
            firstName
            lastName
        }
    }
`);

export const canceledOrderFragment = graphql(`
    fragment CanceledOrder on Order {
        id
        state
        lines {
            id
            quantity
        }
    }
`);

export const paymentFragment = graphql(`
    fragment Payment on Payment {
        id
        transactionId
        amount
        method
        state
        nextStates
        metadata
        refunds {
            id
            total
            reason
        }
    }
`);

export const refundFragment = graphql(`
    fragment Refund on Refund {
        id
        state
        items
        transactionId
        shipping
        total
        metadata
    }
`);

export const orderWithLinesFragment = graphql(
    `
        fragment OrderWithLines on Order {
            id
            createdAt
            updatedAt
            code
            state
            active
            customer {
                id
                firstName
                lastName
            }
            lines {
                id
                featuredAsset {
                    preview
                }
                productVariant {
                    id
                    name
                    sku
                }
                taxLines {
                    description
                    taxRate
                }
                unitPrice
                unitPriceWithTax
                quantity
                unitPrice
                unitPriceWithTax
                taxRate
                linePriceWithTax
            }
            surcharges {
                id
                description
                sku
                price
                priceWithTax
            }
            subTotal
            subTotalWithTax
            total
            totalWithTax
            totalQuantity
            currencyCode
            shipping
            shippingWithTax
            shippingLines {
                priceWithTax
                shippingMethod {
                    id
                    code
                    name
                    description
                }
            }
            shippingAddress {
                ...ShippingAddress
            }
            payments {
                ...Payment
            }
            fulfillments {
                id
                state
                method
                trackingCode
                lines {
                    orderLineId
                    quantity
                }
            }
            total
        }
    `,
    [shippingAddressFragment, paymentFragment],
);

export const orderWithModificationsFragment = graphql(
    `
        fragment OrderWithModifications on Order {
            id
            state
            subTotal
            subTotalWithTax
            shipping
            shippingWithTax
            total
            totalWithTax
            lines {
                id
                quantity
                orderPlacedQuantity
                linePrice
                linePriceWithTax
                unitPriceWithTax
                discountedLinePriceWithTax
                proratedLinePriceWithTax
                proratedUnitPriceWithTax
                discounts {
                    description
                    amountWithTax
                }
                productVariant {
                    id
                    name
                }
            }
            surcharges {
                id
                description
                sku
                price
                priceWithTax
                taxRate
            }
            payments {
                ...Payment
            }
            modifications {
                id
                note
                priceChange
                isSettled
                lines {
                    orderLineId
                    quantity
                }
                surcharges {
                    id
                }
                payment {
                    id
                    state
                    amount
                    method
                }
                refund {
                    id
                    state
                    total
                    paymentId
                }
            }
            promotions {
                id
                name
                couponCode
            }
            discounts {
                description
                adjustmentSource
                amount
                amountWithTax
            }
            shippingAddress {
                ...ShippingAddress
            }
            billingAddress {
                ...ShippingAddress
            }
            shippingLines {
                id
                discountedPriceWithTax
                shippingMethod {
                    id
                    name
                }
            }
        }
    `,
    [paymentFragment, shippingAddressFragment],
);

export const promotionFragment = graphql(
    `
        fragment Promotion on Promotion {
            id
            createdAt
            updatedAt
            couponCode
            startsAt
            endsAt
            name
            description
            enabled
            perCustomerUsageLimit
            usageLimit
            conditions {
                ...ConfigurableOperation
            }
            actions {
                ...ConfigurableOperation
            }
            translations {
                id
                languageCode
                name
                description
            }
        }
    `,
    [configurableFragment],
);

export const zoneFragment = graphql(
    `
        fragment Zone on Zone {
            id
            name
            members {
                ...Country
            }
        }
    `,
    [countryFragment],
);

export const taxRateFragment = graphql(`
    fragment TaxRate on TaxRate {
        id
        name
        enabled
        value
        category {
            id
            name
        }
        zone {
            id
            name
        }
        customerGroup {
            id
            name
        }
    }
`);

export const currentUserFragment = graphql(`
    fragment CurrentUser on CurrentUser {
        id
        identifier
        channels {
            code
            token
            permissions
        }
    }
`);

export const variantWithStockFragment = graphql(`
    fragment VariantWithStock on ProductVariant {
        id
        stockOnHand
        stockAllocated
        stockMovements {
            items {
                ... on StockMovement {
                    id
                    type
                    quantity
                }
            }
            totalItems
        }
    }
`);

export const fulfillmentFragment = graphql(`
    fragment Fulfillment on Fulfillment {
        id
        state
        nextStates
        method
        trackingCode
        lines {
            orderLineId
            quantity
        }
    }
`);

export const channelFragment = graphql(`
    fragment Channel on Channel {
        id
        code
        token
        currencyCode
        availableCurrencyCodes
        defaultCurrencyCode
        defaultLanguageCode
        defaultShippingZone {
            id
        }
        defaultTaxZone {
            id
        }
        pricesIncludeTax
    }
`);

export const globalSettingsFragment = graphql(`
    fragment GlobalSettings on GlobalSettings {
        id
        availableLanguages
        trackInventory
        outOfStockThreshold
        serverConfig {
            orderProcess {
                name
                to
            }
            permittedAssetTypes
            permissions {
                name
                description
                assignable
            }
            customFieldConfig {
                Customer {
                    ... on CustomField {
                        name
                    }
                }
            }
        }
    }
`);

export const customerGroupFragment = graphql(`
    fragment CustomerGroup on CustomerGroup {
        id
        name
        customers {
            items {
                id
            }
            totalItems
        }
    }
`);

export const productOptionGroupFragment = graphql(`
    fragment ProductOptionGroup on ProductOptionGroup {
        id
        code
        name
        options {
            id
            code
            name
        }
        translations {
            id
            languageCode
            name
        }
    }
`);

export const productWithOptionsFragment = graphql(`
    fragment ProductWithOptions on Product {
        id
        optionGroups {
            id
            code
            options {
                id
                code
            }
        }
    }
`);

export const shippingMethodFragment = graphql(`
    fragment ShippingMethod on ShippingMethod {
        id
        code
        name
        description
        calculator {
            code
            args {
                name
                value
            }
        }
        checker {
            code
            args {
                name
                value
            }
        }
    }
`);
