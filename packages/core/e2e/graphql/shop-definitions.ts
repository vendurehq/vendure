import { graphql } from './graphql-shop';

export const testOrderFragment = graphql(`
    fragment TestOrderFragment on Order {
        id
        code
        state
        active
        subTotal
        subTotalWithTax
        shipping
        shippingWithTax
        total
        totalWithTax
        currencyCode
        couponCodes
        discounts {
            adjustmentSource
            amount
            amountWithTax
            description
            type
        }
        lines {
            id
            quantity
            linePrice
            linePriceWithTax
            unitPrice
            unitPriceWithTax
            unitPriceChangeSinceAdded
            unitPriceWithTaxChangeSinceAdded
            discountedUnitPriceWithTax
            proratedUnitPriceWithTax
            productVariant {
                id
            }
            discounts {
                adjustmentSource
                amount
                amountWithTax
                description
                type
            }
        }
        shippingLines {
            priceWithTax
            shippingMethod {
                id
                code
                description
            }
        }
        customer {
            id
            user {
                id
                identifier
            }
        }
        history {
            items {
                id
                type
                data
            }
        }
    }
`);

export const updatedOrderFragment = graphql(`
    fragment UpdatedOrder on Order {
        id
        code
        state
        active
        total
        totalWithTax
        currencyCode
        shipping
        shippingWithTax
        customer {
            id
        }
        shippingAddress {
            fullName
            company
            streetLine1
            streetLine2
            city
            province
            postalCode
            country
            phoneNumber
        }
        billingAddress {
            fullName
            company
            streetLine1
            streetLine2
            city
            province
            postalCode
            country
            phoneNumber
        }
        shippingLines {
            priceWithTax
            shippingMethod {
                id
                code
                description
            }
        }
        payments {
            id
            transactionId
            method
            amount
            state
            metadata
        }
        lines {
            id
            quantity
            productVariant {
                id
            }
            unitPrice
            unitPriceWithTax
            linePrice
            linePriceWithTax
            featuredAsset {
                id
            }
            discounts {
                adjustmentSource
                amount
                amountWithTax
                description
                type
            }
        }
        discounts {
            adjustmentSource
            amount
            amountWithTax
            description
            type
        }
    }
`);

export const updatedOrderWithCustomFieldsFragment = graphql(`
    fragment UpdatedOrderWithCustomFields on Order {
        id
        code
        state
        active
        total
        totalWithTax
        currencyCode
        shipping
        shippingWithTax
        customer {
            id
        }
        shippingAddress {
            fullName
            company
            streetLine1
            streetLine2
            city
            province
            postalCode
            country
            phoneNumber
        }
        billingAddress {
            fullName
            company
            streetLine1
            streetLine2
            city
            province
            postalCode
            country
            phoneNumber
        }
        shippingLines {
            priceWithTax
            shippingMethod {
                id
                code
                description
            }
        }
        payments {
            id
            transactionId
            method
            amount
            state
            metadata
        }
        lines {
            id
            quantity
            productVariant {
                id
            }
            unitPrice
            unitPriceWithTax
            linePrice
            linePriceWithTax
            featuredAsset {
                id
            }
            # Ignore error - customFields are dynamically generated at runtime, not in introspection schema
            customFields {
                notes
                lineImage {
                    id
                }
                lineImages {
                    id
                }
            }
            discounts {
                adjustmentSource
                amount
                amountWithTax
                description
                type
            }
        }
        discounts {
            adjustmentSource
            amount
            amountWithTax
            description
            type
        }
    }
`);

export const addItemToOrderDocument = graphql(
    `
        mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
            addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
                ...UpdatedOrder
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on InsufficientStockError {
                    quantityAvailable
                    order {
                        ...UpdatedOrder
                    }
                }
                ... on OrderInterceptorError {
                    interceptorError
                }
            }
        }
    `,
    [updatedOrderFragment],
);

export const addMultipleItemsToOrderDocument = graphql(
    `
        mutation AddItemsToOrder($inputs: [AddItemInput!]!) {
            addItemsToOrder(inputs: $inputs) {
                order {
                    ...UpdatedOrder
                }
                errorResults {
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        }
    `,
    [updatedOrderFragment],
);

export const setCurrencyCodeForOrderDocument = graphql(
    `
        mutation SetCurrencyCodeForOrder($currencyCode: CurrencyCode!) {
            setCurrencyCodeForOrder(currencyCode: $currencyCode) {
                ...UpdatedOrder
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on InsufficientStockError {
                    quantityAvailable
                    order {
                        ...UpdatedOrder
                    }
                }
                ... on OrderInterceptorError {
                    interceptorError
                }
            }
        }
    `,
    [updatedOrderFragment],
);

export const searchProductsShopDocument = graphql(`
    query SearchProductsShop($input: SearchInput!) {
        search(input: $input) {
            totalItems
            items {
                productId
                productName
                productVariantId
                productVariantName
                sku
                collectionIds
                price {
                    ... on SinglePrice {
                        value
                    }
                    ... on PriceRange {
                        min
                        max
                    }
                }
            }
        }
    }
`);

export const registerAccountDocument = graphql(`
    mutation Register($input: RegisterCustomerInput!) {
        registerCustomerAccount(input: $input) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on PasswordValidationError {
                validationErrorMessage
            }
        }
    }
`);

export const currentUserFragment = graphql(`
    fragment CurrentUserShop on CurrentUser {
        id
        identifier
        channels {
            code
            token
            permissions
        }
    }
`);

export const verifyEmailDocument = graphql(
    `
        mutation Verify($password: String, $token: String!) {
            verifyCustomerAccount(password: $password, token: $token) {
                ...CurrentUserShop
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on PasswordValidationError {
                    validationErrorMessage
                }
            }
        }
    `,
    [currentUserFragment],
);

export const refreshTokenDocument = graphql(`
    mutation RefreshToken($emailAddress: String!) {
        refreshCustomerVerification(emailAddress: $emailAddress) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const requestPasswordResetDocument = graphql(`
    mutation RequestPasswordReset($identifier: String!) {
        requestPasswordReset(emailAddress: $identifier) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const resetPasswordDocument = graphql(
    `
        mutation ResetPassword($token: String!, $password: String!) {
            resetPassword(token: $token, password: $password) {
                ...CurrentUserShop
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on PasswordValidationError {
                    validationErrorMessage
                }
            }
        }
    `,
    [currentUserFragment],
);

export const requestUpdateEmailAddressDocument = graphql(`
    mutation RequestUpdateEmailAddress($password: String!, $newEmailAddress: String!) {
        requestUpdateCustomerEmailAddress(password: $password, newEmailAddress: $newEmailAddress) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const updateEmailAddressDocument = graphql(`
    mutation UpdateEmailAddress($token: String!) {
        updateCustomerEmailAddress(token: $token) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const getActiveCustomerDocument = graphql(`
    query GetActiveCustomer {
        activeCustomer {
            id
            emailAddress
        }
    }
`);

export const createAddressDocument = graphql(`
    mutation CreateAddressShop($input: CreateAddressInput!) {
        createCustomerAddress(input: $input) {
            id
            streetLine1
            country {
                code
            }
        }
    }
`);

export const updateAddressDocument = graphql(`
    mutation UpdateAddressShop($input: UpdateAddressInput!) {
        updateCustomerAddress(input: $input) {
            streetLine1
            country {
                code
            }
        }
    }
`);

export const deleteAddressDocument = graphql(`
    mutation DeleteAddressShop($id: ID!) {
        deleteCustomerAddress(id: $id) {
            success
        }
    }
`);

export const updateCustomerDocument = graphql(`
    mutation UpdateCustomer($input: UpdateCustomerInput!) {
        updateCustomer(input: $input) {
            id
            firstName
            lastName
        }
    }
`);

export const updatePasswordDocument = graphql(`
    mutation UpdatePassword($old: String!, $new: String!) {
        updateCustomerPassword(currentPassword: $old, newPassword: $new) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const getActiveOrderDocument = graphql(
    `
        query GetActiveOrder {
            activeOrder {
                ...TestOrderFragment
            }
        }
    `,
    [testOrderFragment],
);

export const getActiveOrderWithPriceDataDocument = graphql(`
    query GetActiveOrderWithPriceData {
        activeOrder {
            id
            subTotal
            subTotalWithTax
            total
            totalWithTax
            total
            lines {
                id
                unitPrice
                unitPriceWithTax
                taxRate
                linePrice
                lineTax
                linePriceWithTax
                taxLines {
                    taxRate
                    description
                }
            }
            taxSummary {
                description
                taxRate
                taxBase
                taxTotal
            }
        }
    }
`);

export const adjustItemQuantityDocument = graphql(
    `
        mutation AdjustItemQuantity($orderLineId: ID!, $quantity: Int!) {
            adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity) {
                ...TestOrderFragment
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on OrderInterceptorError {
                    interceptorError
                }
            }
        }
    `,
    [testOrderFragment],
);

export const removeItemFromOrderDocument = graphql(
    `
        mutation RemoveItemFromOrder($orderLineId: ID!) {
            removeOrderLine(orderLineId: $orderLineId) {
                ...TestOrderFragment
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on OrderInterceptorError {
                    interceptorError
                }
            }
        }
    `,
    [testOrderFragment],
);

export const getEligibleShippingMethodsDocument = graphql(`
    query GetShippingMethods {
        eligibleShippingMethods {
            id
            code
            price
            name
            description
        }
    }
`);

export const setShippingMethodDocument = graphql(
    `
        mutation SetShippingMethod($id: [ID!]!) {
            setOrderShippingMethod(shippingMethodId: $id) {
                ...TestOrderFragment
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [testOrderFragment],
);

export const activeOrderCustomerDocument = graphql(`
    fragment ActiveOrderCustomer on Order {
        id
        customer {
            id
            emailAddress
            firstName
            lastName
        }
        lines {
            id
        }
    }
`);

export const getActiveOrderCustomerUserDocument = graphql(`
    query GetActiveOrderCustomerUser {
        activeOrder {
            customer {
                id
                user {
                    id
                    verified
                }
            }
        }
    }
`);

export const setCustomerDocument = graphql(
    `
        mutation SetCustomerForOrder($input: CreateCustomerInput!) {
            setCustomerForOrder(input: $input) {
                ...ActiveOrderCustomer
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on GuestCheckoutError {
                    errorDetail
                }
            }
        }
    `,
    [activeOrderCustomerDocument],
);

export const getOrderByCodeDocument = graphql(
    `
        query GetOrderByCode($code: String!) {
            orderByCode(code: $code) {
                ...TestOrderFragment
            }
        }
    `,
    [testOrderFragment],
);

export const getOrderShopDocument = graphql(
    `
        query GetOrderShop($id: ID!) {
            order(id: $id) {
                ...TestOrderFragment
            }
        }
    `,
    [testOrderFragment],
);

export const getOrderPromotionsByCodeDocument = graphql(
    `
        query GetOrderPromotionsByCode($code: String!) {
            orderByCode(code: $code) {
                ...TestOrderFragment
                promotions {
                    id
                    name
                }
            }
        }
    `,
    [testOrderFragment],
);

export const getAvailableCountriesDocument = graphql(`
    query GetAvailableCountries {
        availableCountries {
            id
            code
        }
    }
`);

export const transitionToStateDocument = graphql(
    `
        mutation TransitionToState($state: String!) {
            transitionOrderToState(state: $state) {
                ...TestOrderFragment
                ... on OrderStateTransitionError {
                    errorCode
                    message
                    transitionError
                    fromState
                    toState
                }
            }
        }
    `,
    [testOrderFragment],
);

export const orderWithAddressesFragmentDocument = graphql(`
    fragment OrderWithAddresses on Order {
        lines {
            id
        }
        shippingAddress {
            fullName
            company
            streetLine1
            streetLine2
            city
            province
            postalCode
            country
            phoneNumber
        }
        billingAddress {
            fullName
            company
            streetLine1
            streetLine2
            city
            province
            postalCode
            country
            phoneNumber
        }
    }
`);

export const setShippingAddressDocument = graphql(
    `
        mutation SetShippingAddress($input: CreateAddressInput!) {
            setOrderShippingAddress(input: $input) {
                ...OrderWithAddresses
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithAddressesFragmentDocument],
);

export const setBillingAddressDocument = graphql(
    `
        mutation SetBillingAddress($input: CreateAddressInput!) {
            setOrderBillingAddress(input: $input) {
                ...OrderWithAddresses
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithAddressesFragmentDocument],
);

export const unsetShippingAddressDocument = graphql(
    `
        mutation UnsetShippingAddress {
            unsetOrderShippingAddress {
                ...OrderWithAddresses
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithAddressesFragmentDocument],
);
export const unsetBillingAddressDocument = graphql(
    `
        mutation UnsetBillingAddress {
            unsetOrderBillingAddress {
                ...OrderWithAddresses
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithAddressesFragmentDocument],
);

export const testOrderWithPaymentsFragment = graphql(
    `
        fragment TestOrderWithPayments on Order {
            ...TestOrderFragment
            payments {
                id
                transactionId
                method
                amount
                state
                metadata
            }
        }
    `,
    [testOrderFragment],
);

export const getActiveOrderWithPaymentsDocument = graphql(
    `
        query GetActiveOrderWithPayments {
            activeOrder {
                ...TestOrderWithPayments
            }
        }
    `,
    [testOrderWithPaymentsFragment],
);

export const addPaymentDocument = graphql(
    `
        mutation AddPaymentToOrder($input: PaymentInput!) {
            addPaymentToOrder(input: $input) {
                ...TestOrderWithPayments
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on PaymentDeclinedError {
                    paymentErrorMessage
                }
                ... on PaymentFailedError {
                    paymentErrorMessage
                }
                ... on OrderStateTransitionError {
                    transitionError
                }
                ... on IneligiblePaymentMethodError {
                    eligibilityCheckerMessage
                }
            }
        }
    `,
    [testOrderWithPaymentsFragment],
);

export const getActiveOrderPaymentsDocument = graphql(`
    query GetActiveOrderPayments {
        activeOrder {
            id
            payments {
                id
                transactionId
                method
                amount
                state
                errorMessage
                metadata
            }
        }
    }
`);

export const getOrderByCodeWithPaymentsDocument = graphql(
    `
        query GetOrderByCodeWithPayments($code: String!) {
            orderByCode(code: $code) {
                ...TestOrderWithPayments
            }
        }
    `,
    [testOrderWithPaymentsFragment],
);

export const getActiveOrderCustomerWithItemFulfillmentsDocument = graphql(`
    query GetActiveCustomerOrderWithItemFulfillments {
        activeCustomer {
            orders(
                options: { skip: 0, take: 5, sort: { createdAt: DESC }, filter: { active: { eq: false } } }
            ) {
                totalItems
                items {
                    id
                    code
                    state
                    lines {
                        id
                    }
                    fulfillments {
                        id
                        state
                        method
                        trackingCode
                    }
                }
            }
        }
    }
`);

export const getNextStatesDocument = graphql(`
    query GetNextOrderStates {
        nextOrderStates
    }
`);

export const getActiveOrderAddressesDocument = graphql(`
    query GetCustomerAddresses {
        activeOrder {
            customer {
                addresses {
                    id
                    streetLine1
                }
            }
        }
    }
`);

export const getActiveOrderShippingBillingDocument = graphql(`
    query GetActiveOrderShippingBilling {
        activeOrder {
            shippingAddress {
                ...OrderAddress
            }
            billingAddress {
                ...OrderAddress
            }
        }
    }
    fragment OrderAddress on OrderAddress {
        fullName
        company
        streetLine1
        streetLine2
        city
        province
        postalCode
        countryCode
        phoneNumber
    }
`);

export const getActiveOrderOrdersDocument = graphql(`
    query GetCustomerOrders {
        activeOrder {
            customer {
                orders {
                    items {
                        id
                    }
                }
            }
        }
    }
`);

export const getActiveCustomerOrdersDocument = graphql(`
    query GetActiveCustomerOrders {
        activeCustomer {
            id
            orders {
                totalItems
                items {
                    id
                    state
                }
            }
        }
    }
`);

export const applyCouponCodeDocument = graphql(
    `
        mutation ApplyCouponCode($couponCode: String!) {
            applyCouponCode(couponCode: $couponCode) {
                ...TestOrderFragment
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [testOrderFragment],
);

export const removeCouponCodeDocument = graphql(
    `
        mutation RemoveCouponCode($couponCode: String!) {
            removeCouponCode(couponCode: $couponCode) {
                ...TestOrderFragment
            }
        }
    `,
    [testOrderFragment],
);

export const removeAllOrderLinesDocument = graphql(
    `
        mutation RemoveAllOrderLines {
            removeAllOrderLines {
                ...TestOrderFragment
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [testOrderFragment],
);

export const getEligiblePaymentMethodsDocument = graphql(`
    query GetEligiblePaymentMethods {
        eligiblePaymentMethods {
            id
            code
            eligibilityMessage
            isEligible
        }
    }
`);

export const getProductWithStockLevelDocument = graphql(`
    query GetProductStockLevel($id: ID!) {
        product(id: $id) {
            id
            variants {
                id
                stockLevel
            }
        }
    }
`);

export const getActiveCustomerWithOrdersProductSlugDocument = graphql(`
    query GetActiveCustomerWithOrdersProductSlug($options: OrderListOptions) {
        activeCustomer {
            orders(options: $options) {
                items {
                    lines {
                        productVariant {
                            product {
                                slug
                            }
                        }
                    }
                }
            }
        }
    }
`);
export const getActiveCustomerWithOrdersProductPriceDocument = graphql(`
    query GetActiveCustomerWithOrdersProductPrice($options: OrderListOptions) {
        activeCustomer {
            orders(options: $options) {
                items {
                    lines {
                        linePrice
                        productVariant {
                            id
                            name
                            price
                        }
                    }
                }
            }
        }
    }
`);

export const activePaymentMethodsQueryDocument = graphql(`
    query ActivePaymentMethods {
        activePaymentMethods {
            id
            code
            name
            description
            translations {
                languageCode
                name
                description
            }
        }
    }
`);

export const getActiveShippingMethodsDocument = graphql(`
    query GetActiveShippingMethods {
        activeShippingMethods {
            id
            code
            name
            description
            translations {
                languageCode
                name
                description
            }
        }
    }
`);

export const getCollectionShopDocument = graphql(`
    query GetCollectionShop($id: ID, $slug: String) {
        collection(id: $id, slug: $slug) {
            id
            name
            slug
            description
            parent {
                id
                name
            }
            children {
                id
                name
            }
        }
    }
`);

export const getCollectionVariantsDocument = graphql(`
    query GetCollectionVariants($id: ID, $slug: String) {
        collection(id: $id, slug: $slug) {
            id
            productVariants {
                items {
                    id
                    name
                }
            }
        }
    }
`);

export const getCollectionListDocument = graphql(`
    query GetCollectionList {
        collections {
            items {
                id
                name
            }
        }
    }
`);

export const getProductFacetValuesDocument = graphql(`
    query GetProductFacetValues($id: ID!) {
        product(id: $id) {
            id
            name
            facetValues {
                name
            }
        }
    }
`);

export const getProductVariantFacetValuesDocument = graphql(`
    query GetVariantFacetValues($id: ID!) {
        product(id: $id) {
            id
            name
            variants {
                id
                facetValues {
                    name
                }
            }
        }
    }
`);

export const getProductsTake3Document = graphql(`
    query GetProductsTake3 {
        products(options: { take: 3 }) {
            items {
                id
            }
        }
    }
`);

export const getProduct1Document = graphql(`
    query GetProduct1 {
        product(id: "T_1") {
            id
        }
    }
`);

export const getProduct2VariantsDocument = graphql(`
    query GetProduct2Variants {
        product(id: "T_2") {
            id
            variants {
                id
                name
            }
        }
    }
`);

export const getProductCollectionDocument = graphql(`
    query GetProductCollection {
        product(id: "T_12") {
            collections {
                id
                name
            }
        }
    }
`);

export const getOrderCustomFieldsDocument = graphql(`
    query GetOrderCustomFields {
        activeOrder {
            id
            customFields {
                giftWrap
                orderImage {
                    id
                }
            }
        }
    }
`);

export const setOrderCustomFieldsDocument = graphql(`
    mutation SetOrderCustomFields($input: UpdateOrderInput!) {
        setOrderCustomFields(input: $input) {
            ... on Order {
                id
                customFields {
                    giftWrap
                    orderImage {
                        id
                    }
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const logOutDocument = graphql(`
    mutation LogOut {
        logout {
            success
        }
    }
`);

export const addItemToOrderWithCustomFieldsDocument = graphql(
    `
        mutation AddItemToOrderWithCustomFields(
            $productVariantId: ID!
            $quantity: Int!
            $customFields: OrderLineCustomFieldsInput
        ) {
            addItemToOrder(
                productVariantId: $productVariantId
                quantity: $quantity
                customFields: $customFields
            ) {
                ...UpdatedOrderWithCustomFields
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [updatedOrderWithCustomFieldsFragment],
);

export const addMultipleItemsToOrderWithCustomFieldsDocument = graphql(
    `
        mutation AddMultipleItemsToOrderWithCustomFields($inputs: [AddItemInput!]!) {
            addItemsToOrder(inputs: $inputs) {
                order {
                    ...UpdatedOrder
                    lines {
                        id
                        quantity
                        productVariant {
                            id
                        }
                        customFields {
                            notes
                        }
                    }
                }
                errorResults {
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        }
    `,
    [updatedOrderFragment],
);

export const adjustOrderLineWithCustomFieldsDocument = graphql(`
    mutation AdjustOrderLineWithCustomFields(
        $orderLineId: ID!
        $quantity: Int!
        $customFields: OrderLineCustomFieldsInput
    ) {
        adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity, customFields: $customFields) {
            ... on Order {
                lines {
                    id
                    customFields {
                        notes
                        lineImage {
                            id
                        }
                        lineImages {
                            id
                        }
                    }
                }
            }
        }
    }
`);

export const getOrderWithOrderLineCustomFieldsDocument = graphql(`
    query GetOrderWithOrderLineCustomFields {
        activeOrder {
            lines {
                id
                customFields {
                    notes
                    lineImage {
                        id
                    }
                    lineImages {
                        id
                    }
                }
            }
        }
    }
`);

export const localUpdatedOrderFragment = graphql(`
    fragment UpdatedOrderMinimal on Order {
        id
        code
        state
        active
        total
        totalWithTax
        currencyCode
        lines {
            id
            linePrice
            linePriceWithTax
        }
    }
`);

export const localAddItemToOrderDocument = graphql(
    `
        mutation AddItemToOrderMinimal($productVariantId: ID!, $quantity: Int!) {
            addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
                ...UpdatedOrderMinimal
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on InsufficientStockError {
                    quantityAvailable
                    order {
                        ...UpdatedOrderMinimal
                    }
                }
            }
        }
    `,
    [localUpdatedOrderFragment],
);

export const searchFacetValuesDocument = graphql(`
    query SearchFacetValues($input: SearchInput!) {
        search(input: $input) {
            totalItems
            facetValues {
                count
                facetValue {
                    id
                    name
                }
            }
        }
    }
`);

export const searchCollectionsDocument = graphql(`
    query SearchCollections($input: SearchInput!) {
        search(input: $input) {
            totalItems
            collections {
                count
                collection {
                    id
                    name
                }
            }
        }
    }
`);

export const searchGetPricesShopDocument = graphql(`
    query SearchGetPrices($input: SearchInput!) {
        search(input: $input) {
            items {
                price {
                    ... on PriceRange {
                        min
                        max
                    }
                    ... on SinglePrice {
                        value
                    }
                }
                priceWithTax {
                    ... on PriceRange {
                        min
                        max
                    }
                    ... on SinglePrice {
                        value
                    }
                }
            }
        }
    }
`);

export const orderWithLinesAndItemsFragment = graphql(`
    fragment OrderWithLinesAndItems on Order {
        id
        subTotal
        subTotalWithTax
        shipping
        total
        totalWithTax
        lines {
            id
            quantity
            unitPrice
            unitPriceWithTax
        }
    }
`);

export const addItemToOrderCustomFieldsDocument = graphql(
    `
        mutation AddItemToOrderCustomFields(
            $productVariantId: ID!
            $quantity: Int!
            $customFields: OrderLineCustomFieldsInput
        ) {
            addItemToOrder(
                productVariantId: $productVariantId
                quantity: $quantity
                customFields: $customFields
            ) {
                ...OrderWithLinesAndItems
            }
        }
    `,
    [orderWithLinesAndItemsFragment],
);

export const adjustOrderLineCustomFieldsDocument = graphql(
    `
        mutation AdjustOrderLineCustomFields(
            $orderLineId: ID!
            $quantity: Int!
            $customFields: OrderLineCustomFieldsInput
        ) {
            adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity, customFields: $customFields) {
                ...OrderWithLinesAndItems
            }
        }
    `,
    [orderWithLinesAndItemsFragment],
);

export const registerSellerDocument = graphql(`
    mutation RegisterSeller($input: RegisterSellerInput!) {
        registerNewSeller(input: $input) {
            id
            code
            token
        }
    }
`);
