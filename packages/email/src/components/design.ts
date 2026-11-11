import { createContext, useContext } from 'react';

/**
 * @description
 * The design of all emails that admins can change in the Dashboard (System > Emails > Design). It is
 * stored per channel, or for all channels, and applies on top of the code: the `branding` template
 * variable and the defaults of the email components. Every field is optional; a missing field keeps
 * the value from code.
 *
 * Templates don't read it directly. The components ({@link EmailLayout}, {@link EmailButton} and
 * so on) apply it, so custom templates built from them follow the design too.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
export interface EmailDesign {
    /** The shop name, shown above the card when there is no logo, and as the logo's alt text. */
    name?: string;
    /** An absolute `http(s)` URL. */
    logoUrl?: string;
    /** The logo height in pixels, 16 to 96. Defaults to 32. */
    logoHeight?: number;
    /** Where the logo or shop name sits above the card. Defaults to `'left'`. */
    headerAlign?: 'left' | 'center';
    /** The colour of buttons and links, as `#rrggbb`. */
    primaryColor?: string;
    /** The text colour on buttons, as `#rrggbb`. */
    primaryTextColor?: string;
    /** One of the font stacks in {@link emailFontStacks}. */
    fontFamily?: string;
    /** The colour around the card, as `#rrggbb`. */
    pageBackground?: string;
    /** The colour of the card, as `#rrggbb`. */
    cardBackground?: string;
    /** The corner radius of the card in pixels, 0 to 32. */
    cardRadius?: number;
    /** The corner radius of buttons in pixels, 0 to 32. */
    buttonRadius?: number;
    /** Shown below the card, e.g. the company address. */
    footerText?: string;
}

/**
 * @description
 * The fonts the Dashboard offers. Each is a stack of fonts that email clients have installed, since
 * most clients don't load web fonts.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
export const emailFontStacks: ReadonlyArray<{ label: string; value: string }> = [
    {
        label: 'System',
        value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    },
    { label: 'Helvetica', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
    { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
    { label: 'Trebuchet', value: "'Trebuchet MS', 'Lucida Grande', sans-serif" },
    { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
    { label: 'Palatino', value: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
    { label: 'Courier', value: "'Courier New', Courier, monospace" },
];

/**
 * @description
 * The kind of value of each {@link EmailDesign} field, so editors can show the right input.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
export type EmailDesignFieldKind = 'text' | 'multiline' | 'url' | 'color' | 'number' | 'font' | 'align';

/** @internal */
export const emailDesignFields: ReadonlyArray<{
    name: keyof EmailDesign;
    label: string;
    kind: EmailDesignFieldKind;
    group: 'brand' | 'layout';
    min?: number;
    max?: number;
}> = [
    { name: 'name', label: 'Shop name', kind: 'text', group: 'brand' },
    { name: 'logoUrl', label: 'Logo URL', kind: 'url', group: 'brand' },
    { name: 'logoHeight', label: 'Logo height', kind: 'number', group: 'brand', min: 16, max: 96 },
    { name: 'headerAlign', label: 'Header alignment', kind: 'align', group: 'brand' },
    { name: 'primaryColor', label: 'Brand colour', kind: 'color', group: 'brand' },
    { name: 'primaryTextColor', label: 'Button text colour', kind: 'color', group: 'brand' },
    { name: 'footerText', label: 'Footer text', kind: 'multiline', group: 'brand' },
    { name: 'fontFamily', label: 'Font', kind: 'font', group: 'layout' },
    { name: 'pageBackground', label: 'Page background', kind: 'color', group: 'layout' },
    { name: 'cardBackground', label: 'Card background', kind: 'color', group: 'layout' },
    { name: 'cardRadius', label: 'Card corner radius', kind: 'number', group: 'layout', min: 0, max: 32 },
    { name: 'buttonRadius', label: 'Button corner radius', kind: 'number', group: 'layout', min: 0, max: 32 },
];

const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_TEXT_LENGTH = 500;

/**
 * @description
 * Checks a design before it is stored. Returns one message per problem; an empty list means it is
 * valid. Values are checked strictly because they end up in the CSS of every email.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
export function validateEmailDesign(design: Record<string, unknown>): string[] {
    const problems: string[] = [];
    for (const [name, value] of Object.entries(design)) {
        const field = emailDesignFields.find(f => f.name === name);
        if (!field) {
            problems.push(`"${name}" is not a design setting.`);
            continue;
        }
        if (value == null) {
            continue;
        }
        const problem = checkValue(field, value);
        if (problem) {
            problems.push(`${field.label}: ${problem}`);
        }
    }
    return problems;
}

function checkValue(field: (typeof emailDesignFields)[number], value: unknown): string | undefined {
    switch (field.kind) {
        case 'color':
            return typeof value === 'string' && COLOR.test(value) ? undefined : 'use a colour like #1a2b3c.';
        case 'url':
            return typeof value === 'string' && /^https?:\/\/[^\s"'<>()]+$/.test(value)
                ? undefined
                : 'use an absolute http or https URL.';
        case 'number':
            return typeof value === 'number' &&
                Number.isInteger(value) &&
                value >= (field.min ?? 0) &&
                value <= (field.max ?? Infinity)
                ? undefined
                : `use a whole number from ${field.min ?? 0} to ${field.max ?? ''}.`;
        case 'font':
            return emailFontStacks.some(f => f.value === value)
                ? undefined
                : 'pick one of the offered fonts.';
        case 'align':
            return value === 'left' || value === 'center' ? undefined : 'use left or center.';
        default:
            return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH
                ? undefined
                : `use text of at most ${MAX_TEXT_LENGTH} characters.`;
    }
}

/**
 * @description
 * Merges designs, later ones winning. Missing, null and empty values don't override.
 *
 * @internal
 */
export function mergeEmailDesigns(...designs: Array<EmailDesign | undefined | null>): EmailDesign {
    const result: Record<string, unknown> = {};
    for (const design of designs) {
        for (const [name, value] of Object.entries(design ?? {})) {
            if (value != null && value !== '') {
                result[name] = value;
            }
        }
    }
    return result;
}

/** @internal Provided around every render with the design stored in the Dashboard. */
export const EmailDesignContext = createContext<EmailDesign>({});

/**
 * @description
 * The {@link EmailDesign} set in the Dashboard for the email being rendered. Empty outside a render,
 * or when nothing is stored.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
export function useEmailDesign(): EmailDesign {
    return useContext(EmailDesignContext);
}
