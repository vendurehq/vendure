/**
 * @description
 * Formats an amount of money, which Vendure stores as an integer in the minor unit of the
 * currency (e.g. cents), e.g. `formatMoney(1234, 'USD', 'en')` => `"$12.34"`. If no currency code
 * is given, the amount is formatted as a plain decimal number.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function formatMoney(amount: number, currencyCode?: string | null, locale?: string): string {
    const resolvedLocale = toIntlLocale(locale);
    if (!currencyCode) {
        return new Intl.NumberFormat(resolvedLocale, { style: 'decimal' }).format(amount / 100);
    }
    return new Intl.NumberFormat(resolvedLocale, { style: 'currency', currency: currencyCode }).format(
        amount / 100,
    );
}

/**
 * @description
 * Formats a date, given either as a `Date` or as an ISO date string (which is how dates arrive in
 * templates after passing through the job queue).
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function formatDate(
    value: Date | string,
    locale?: string,
    options?: Intl.DateTimeFormatOptions,
): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(toIntlLocale(locale), options ?? { dateStyle: 'medium' }).format(date);
}

/**
 * @description
 * Appends a `token` query parameter to a URL, e.g. for verification and password reset links.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function urlWithToken(url: string | undefined | null, token: string | undefined | null): string {
    const base = url ?? '';
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}token=${encodeURIComponent(token ?? '')}`;
}

/**
 * Vendure LanguageCodes use underscores (`pt_BR`), Intl expects BCP 47 tags (`pt-BR`).
 */
function toIntlLocale(locale: string | undefined): string | undefined {
    if (!locale) {
        return undefined;
    }
    const tag = locale.replace(/_/g, '-');
    try {
        return Intl.getCanonicalLocales(tag)[0];
    } catch {
        return undefined;
    }
}
