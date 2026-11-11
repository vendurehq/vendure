import { graphql as dashboardGraphql } from '@vendure/dashboard';

// The dashboard's `graphql` is typed against the core Admin API only, so the plugin's operations are
// declared untyped here and their results typed by hand below.
const graphql = dashboardGraphql as unknown as (source: string) => any;

export interface OrderEmailTarget {
    id: string;
    label: string;
    eligible: boolean;
    reason?: string | null;
}

export interface OrderEmailList {
    orderEmails: {
        recipient?: string | null;
        emails: Array<{ type: string; label: string; targets: OrderEmailTarget[] }>;
    };
}

export interface OrderEmailPreviewResult {
    previewOrderEmail: { recipient: string; from: string; subject: string; html: string; templateOrigin: string };
}

export const orderEmailsQuery = graphql(`
    query OrderEmails($orderId: ID!) {
        orderEmails(orderId: $orderId) {
            recipient
            emails {
                type
                label
                targets {
                    id
                    label
                    eligible
                    reason
                }
            }
        }
    }
`);

export const previewOrderEmailQuery = graphql(`
    query PreviewOrderEmail($input: OrderEmailInput!) {
        previewOrderEmail(input: $input) {
            recipient
            from
            subject
            html
            templateOrigin
        }
    }
`);

export const sendOrderEmailMutation = graphql(`
    mutation SendOrderEmail($input: SendOrderEmailInput!) {
        sendOrderEmail(input: $input) {
            success
            recipient
        }
    }
`);

export interface EmailOverviewResult {
    emailOverview: {
        devMode: boolean;
        emails: Array<{ type: string; label: string; event: string; hasSample: boolean; canSendFromOrder: boolean }>;
    };
}

export interface EmailPreviewResult {
    previewEmail: {
        type: string;
        languageCode: string;
        channelCode: string;
        recipient: string;
        from: string;
        subject: string;
        html: string;
        text: string;
        templateOrigin: string;
    };
}

export interface EmailOutboxResult {
    emailOutbox: Array<{
        id: string;
        sentAt: string;
        status: string;
        type: string;
        recipient?: string | null;
        subject?: string | null;
        languageCode?: string | null;
        templateOrigin?: string | null;
        error?: string | null;
        html?: string | null;
    }>;
}

export const emailOverviewQuery = graphql(`
    query EmailOverview {
        emailOverview {
            devMode
            emails {
                type
                label
                event
                hasSample
                canSendFromOrder
            }
        }
    }
`);

export const previewEmailQuery = graphql(`
    query PreviewEmail($input: EmailPreviewInput!) {
        previewEmail(input: $input) {
            type
            languageCode
            channelCode
            recipient
            from
            subject
            html
            text
            templateOrigin
        }
    }
`);

export const emailOutboxQuery = graphql(`
    query EmailOutbox($limit: Int) {
        emailOutbox(limit: $limit) {
            id
            sentAt
            status
            type
            recipient
            subject
            languageCode
            templateOrigin
            error
            html
        }
    }
`);
