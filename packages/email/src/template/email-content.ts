import { createContext, useContext } from 'react';

import { EmailTemplate } from './email-template';
import { interpolateTemplateString } from './interpolate';

/**
 * @description
 * Where the text of a content slot came from:
 *
 * - `draft`: unsaved text passed to a preview
 * - `channel`: an override stored for this channel and language
 * - `all-channels`: an override stored for all channels in this language
 * - `default`: the default text of the template
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export type EmailContentOrigin = 'draft' | 'channel' | 'all-channels' | 'default';

/**
 * @description
 * Variables that every email's text can use, in addition to the template's own.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export const builtInEmailVariables: Record<string, { label: string; value: (props: any) => unknown }> = {
    shopName: { label: 'Shop name', value: props => props?.branding?.name },
};

/** @internal */
export const EmailContentReactContext = createContext<Record<string, string> | undefined>(undefined);

/**
 * @description
 * Returns the text of the template's content slots, with overrides applied and `{{ variables }}`
 * filled in. Use it in a template's `body`.
 *
 * @example
 * ```tsx
 * body: ({ branding }) => {
 *     const content = useEmailContent();
 *     return <EmailTitle>{content.title}</EmailTitle>;
 * },
 * ```
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export function useEmailContent(): Record<string, string> {
    return useContext(EmailContentReactContext) ?? {};
}

/**
 * @description
 * The stored overrides that apply to one email, in one language and channel.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export interface EmailContentOverrides {
    channel?: Record<string, string>;
    allChannels?: Record<string, string>;
}

/**
 * Resolves the text of every content slot of a template: the draft, then the channel override, then
 * the all-channels override, then the default. Empty strings count as "not set". Then fills in the
 * variables.
 */
export function resolveEmailContent(
    template: EmailTemplate,
    props: Record<string, any>,
    context: { languageCode: string; channelCode: string },
    overrides: EmailContentOverrides = {},
    draft: Record<string, string> = {},
): { values: Record<string, string>; origins: Record<string, EmailContentOrigin> } {
    const variables = computeEmailVariables(template, props, context);
    const values: Record<string, string> = {};
    const origins: Record<string, EmailContentOrigin> = {};
    for (const [name, slot] of Object.entries(template.content ?? {})) {
        const candidates: Array<[EmailContentOrigin, string | undefined]> = [
            ['draft', draft[name]],
            ['channel', overrides.channel?.[name]],
            ['all-channels', overrides.allChannels?.[name]],
        ];
        const [origin, text] = candidates.find(([, value]) => typeof value === 'string' && value.trim() !== '') ?? [
            'default',
            slot.default,
        ];
        values[name] = interpolateTemplateString(text ?? '', variables);
        origins[name] = origin;
    }
    return { values, origins };
}

/**
 * Computes the display values of the template's variables and the built-in ones.
 */
export function computeEmailVariables(
    template: EmailTemplate,
    props: Record<string, any>,
    context: { languageCode: string; channelCode: string },
): Record<string, string> {
    const result: Record<string, string> = {};
    const all = { ...builtInEmailVariables, ...(template.variables ?? {}) };
    for (const [name, variable] of Object.entries(all)) {
        let value: unknown;
        try {
            value = variable.value(props, context);
        } catch {
            value = undefined;
        }
        result[name] = value == null ? '' : String(value);
    }
    return result;
}

/**
 * @description
 * The variables an email's text may use, with their labels: the built-in ones and the template's.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export function listEmailVariables(template: EmailTemplate): Array<{ name: string; label: string }> {
    const all = { ...builtInEmailVariables, ...(template.variables ?? {}) };
    return Object.entries(all).map(([name, variable]) => ({ name, label: variable.label }));
}

const PLACEHOLDER_NAMES = /\{\{\{?\s*([^}\s]+)\s*\}?\}\}/g;

/**
 * @description
 * Checks text for a template's content slots: every slot must exist, and every `{{ placeholder }}`
 * must be one of the template's variables. Returns the problems, or an empty array.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export function validateEmailContent(template: EmailTemplate, content: Record<string, string>): string[] {
    const slots = template.content ?? {};
    const variableNames = new Set(listEmailVariables(template).map(v => v.name));
    const problems: string[] = [];
    for (const [name, text] of Object.entries(content)) {
        if (!slots[name]) {
            problems.push(`"${name}" is not a content slot of this email`);
            continue;
        }
        for (const match of String(text).matchAll(PLACEHOLDER_NAMES)) {
            if (!variableNames.has(match[1])) {
                problems.push(
                    `${slots[name].label}: {{ ${match[1]} }} is not a variable of this email. ` +
                        `Available: ${[...variableNames].join(', ')}`,
                );
            }
        }
    }
    return problems;
}
