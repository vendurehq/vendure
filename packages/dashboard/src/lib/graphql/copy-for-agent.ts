import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { toast } from 'sonner';
import { uiConfig } from 'virtual:vendure-ui-config';

/**
 * @description
 * What "Copy for agent" puts on the clipboard, as JSON. The code says what failed, and the request ID
 * finds the request's log lines.
 */
export interface AgentErrorReport {
    code: string;
    message: string;
    requestId: string;
    operation: string | null;
    versions: { dashboard: string };
}

/**
 * How long after a failed request an error toast can be about that request. Toasts are raised by the
 * code that made the request, straight after it fails.
 */
const MATCH_WINDOW_MS = 10_000;

let lastError: { report: AgentErrorReport; at: number } | undefined;

function operationName(document: string): string | null {
    return /^\s*(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(document)?.[1] ?? null;
}

/**
 * @description
 * Builds the report for a failed GraphQL request. Returns undefined when the error has no
 * `vendureCode` or `requestId` extension, such as a network error, so no action is offered.
 */
export function toAgentErrorReport(error: unknown, document: string): AgentErrorReport | undefined {
    const { message, extensions, fieldErrors } = (error ?? {}) as {
        message?: unknown;
        extensions?: { vendureCode?: unknown; requestId?: unknown };
        fieldErrors?: Array<{ message?: unknown }>;
    };
    if (typeof extensions?.vendureCode !== 'string' || typeof extensions.requestId !== 'string') {
        return undefined;
    }
    // The client prefixes its own error message, so the server's message is read from the first error.
    const serverMessage = fieldErrors?.[0]?.message ?? message;
    return {
        code: extensions.vendureCode,
        message: typeof serverMessage === 'string' ? serverMessage : '',
        requestId: extensions.requestId,
        operation: operationName(document),
        versions: { dashboard: uiConfig.version },
    };
}

export function formatAgentErrorReport(report: AgentErrorReport): string {
    return JSON.stringify(report, null, 2);
}

/**
 * @description
 * Remembers a failed GraphQL request, so the error toast that follows it can offer "Copy for agent".
 * It does nothing outside development.
 */
export function recordGraphQLError(error: unknown, document: string, now = Date.now()): void {
    if (!import.meta.env.DEV) {
        return;
    }
    const report = toAgentErrorReport(error, document);
    if (report) {
        lastError = { report, at: now };
    }
}

/**
 * Takes the recorded error when it is recent and the toast shows its message, so a toast is only
 * offered the error it is about. Each error is offered on one toast only.
 */
export function takeMatchingAgentErrorReport(
    toastText: string[],
    now = Date.now(),
): AgentErrorReport | undefined {
    if (!lastError || now - lastError.at > MATCH_WINDOW_MS) {
        lastError = undefined;
        return undefined;
    }
    const { report } = lastError;
    if (!report.message || !toastText.some(text => text.includes(report.message))) {
        return undefined;
    }
    lastError = undefined;
    return report;
}

type ErrorToastMessage = Parameters<typeof toast.error>[0];
type ErrorToastData = Parameters<typeof toast.error>[1];

function withCopyForAgentAction(message: ErrorToastMessage, data: ErrorToastData): ErrorToastData {
    if (data?.action) {
        return data;
    }
    const toastText = [message, data?.description].filter((text): text is string => typeof text === 'string');
    const report = takeMatchingAgentErrorReport(toastText);
    if (!report) {
        return data;
    }
    return {
        ...data,
        action: {
            label: i18n._(msg`Copy for agent`),
            onClick: () => {
                const text = formatAgentErrorReport(report);
                void navigator.clipboard.writeText(text).then(
                    () => toast.success(i18n._(msg`Copied the error for your agent`)),
                    () => {
                        // The clipboard can be unavailable or refused, so the text is logged to copy by hand.
                        console.info(text);
                        toast.info(i18n._(msg`Could not copy. The error is in the browser console.`));
                    },
                );
            },
        },
    };
}

let installed = false;

/**
 * @description
 * In development, adds a "Copy for agent" action to an error toast that shows the message of a
 * GraphQL request that just failed. It does nothing outside development.
 *
 * Error toasts are raised in many places, and all of them go through sonner's shared `toast` object.
 * So the action is added there, not at each call site.
 */
export function installCopyForAgentToasts(): void {
    if (!import.meta.env.DEV || installed) {
        return;
    }
    installed = true;
    const showError = toast.error;
    toast.error = (message, data) => showError(message, withCopyForAgentAction(message, data));
}
