import { useDisplayLocale } from '@/vdb/hooks/use-display-locale.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { FormatProvider } from '@vendure-io/ui/components/molecules/format-provider';
import React from 'react';

/**
 * @description
 * Bridges the host-owned formatting settings into the `@vendure-io/ui`
 * `FormatProvider` context, so the v2 `Money` / `DateTime` molecules format
 * identically to the dashboard's own `useLocalFormat` hook. This is a
 * one-directional bridge (host → v2 context): `useLocalFormat` remains the
 * host formatting API, and this provider mirrors the same reactive sources
 * (display language/region and `moneyStrategyPrecision`) into the molecules.
 *
 * Currency is intentionally left unset here — it is domain data supplied per
 * call site (from the order/variant being rendered), never a global default.
 */
export function FormatBridge({ children }: { children: React.ReactNode }) {
    const { bcp47Tag } = useDisplayLocale();
    const { moneyStrategyPrecision } = useServerConfig() ?? { moneyStrategyPrecision: 2 };
    return (
        <FormatProvider locale={bcp47Tag} currencyPrecision={moneyStrategyPrecision}>
            {children}
        </FormatProvider>
    );
}
