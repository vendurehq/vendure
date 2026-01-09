import { gql } from 'graphql-tag';

const commonSchemaExtensions = gql`
    input MolliePaymentIntentInput {
        """
        The code of the Vendure payment method to use for the payment.
        Must have Mollie as payment method handler.
        Without this, the first method with Mollie as handler will be used.
        """
        paymentMethodCode: String
        """
        The redirect url to which the customer will be redirected after the payment is completed.
        The configured fallback redirect will be used if this is not provided.
        """
        redirectUrl: String
        """
        Optional preselected Mollie payment method. When this is passed
        the payment selection step will be skipped.
        """
        molliePaymentMethodCode: String
        """
        Use this to create a payment intent for a specific order. This allows you to create intents for
        orders that are not active orders.
        """
        orderId: String
        """
        By default, pay later methods like Klarna will be immediately captured.
        Set this to false when you expect that order fulfillment takes longer than 24 hours.
        If set to false, you will need to settle the "Authorized" payment in Vendure manually!
        If you fail to do so, the Authorized payment will expire after 28 days.
        """
        immediateCapture: Boolean
        """
        Specify a locale for Mollie's hosted checkout. If not provided, Mollie will detect the browser language.
        The supported locales can be found here: https://docs.mollie.com/reference/common-data-types#locale
        """
        locale: String
    }

    type MolliePaymentIntent {
        url: String!
    }

    type MolliePaymentIntentError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
    }

    union MolliePaymentIntentResult = MolliePaymentIntent | MolliePaymentIntentError

    extend type Mutation {
        createMolliePaymentIntent(input: MolliePaymentIntentInput!): MolliePaymentIntentResult!
        """
        Fetch the payment status from Mollie and update the order status in Vendure accordingly.
        use this mutation when the Mollie webhook is delayed and youy want to force update the order status.
        Throws a ForbiddenError for unauthenticated calls when the order is not yet settled.
        """
        syncMolliePaymentStatus(orderCode: String!): Order
    }
`;

export const shopApiExtensions = gql`
    ${commonSchemaExtensions}

    type MollieAmount {
        value: String
        currency: String
    }
    type MolliePaymentMethodImages {
        size1x: String
        size2x: String
        svg: String
    }
    type MolliePaymentMethod {
        id: ID!
        code: String!
        description: String
        minimumAmount: MollieAmount
        maximumAmount: MollieAmount
        image: MolliePaymentMethodImages
        status: String
    }

    input MolliePaymentMethodsInput {
        paymentMethodCode: String!
    }

    extend type Query {
        molliePaymentMethods(input: MolliePaymentMethodsInput!): [MolliePaymentMethod!]!
    }
`;

export const adminApiExtensions = gql`
    ${commonSchemaExtensions}

    extend enum ErrorCode {
        ORDER_PAYMENT_STATE_ERROR
    }
`;
