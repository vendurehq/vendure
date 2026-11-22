import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { toast } from 'sonner';
import { uiConfig } from 'virtual:vendure-ui-config';

/**
 * @description
 * What "Copy for agent" puts on the clipboard, followed by the `vendure explain` command for the
 * request. It is enough for a coding agent to find the error's log lines and act on its code.
 */
export interface AgentErrorReport {
    code: string;
    message: string;
    requestId: string;
    operation: string | null;
    versions: { dashboard: string };
}

/**
 * How long after a failed request an error toast is taken to be about that request. Toasts are
 * raised by the code that made the request, straight after it fails.
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
    const { message, extensions } = (error ?? {}) as {
        message?: unknown;
        extensions?: { vendureCode?: unknown; requestId?: unknown };
    };
    if (typeof extensions?.vendureCode !== 'string' || typeof extensions.requestId !== 'string') {
        return undefined;
    }
    return {
        code: extensions.vendureCode,
        message: typeof message === 'string' ? message : '',
        requestId: extensions.requestId,
        operation: operationName(document),
        versions: { dashboard: uiConfig.version },
    };
}

/** The clipboard text: the report as JSON, then the command that collects its log lines. */
export function formatAgentErrorReport(report: AgentErrorReport): string {
    return `${JSON.stringify(report, null, 2)}\n\nvendure explain ${report.requestId}`;
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
 * Takes the recorded error if it is recent. Each error is offered on one toast only, so a later,
 * unrelated toast does not copy it.
 */
export function takeRecentAgentErrorReport(now = Date.now()): AgentErrorReport | undefined {
    const recent = lastError && now - lastError.at <= MATCH_WINDOW_MS ? lastError.report : undefined;
    lastError = undefined;
    return recent;
}

type ErrorToastData = Parameters<typeof toast.error>[1];

function withCopyForAgentAction(data: ErrorToastData): ErrorToastData {
    if (data?.action) {
        return data;
    }
    const report = takeRecentAgentErrorReport();
    if (!report) {
        return data;
    }
    return {
        ...data,
        action: {
            label: i18n._(msg`Copy for agent`),
            onClick: () => {
                void navigator.clipboard.writeText(formatAgentErrorReport(report)).then(
                    () => toast.success(i18n._(msg`Copied the error for your agent`)),
                    () => undefined,
                );
            },
        },
    };
}

let installed = false;

/**
 * @description
 * In development, adds a "Copy for agent" action to each error toast that follows a failed GraphQL
 * request. Error toasts are raised in many places, all through sonner's shared `toast` object, so the
 * action is added there rather than at each call site. It does nothing outside development.
 */
export function installCopyForAgentToasts(): void {
    if (!import.meta.env.DEV || installed) {
        return;
    }
    installed = true;
    const showError = toast.error;
    toast.error = (message, data) => showError(message, withCopyForAgentAction(data));
}
