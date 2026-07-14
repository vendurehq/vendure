import { IconMark } from '@/vdb/components/shared/icon-mark.js';
import { uiConfig } from 'virtual:vendure-ui-config';

// Tamper-resistance: These !important rules ensure the branding remains visible
// even when extension stylesheets attempt to hide it. This is a licensing requirement.
const BRANDING_STYLE_ID = 'vendure-branding-style';

function BrandingStyle() {
    if (typeof document !== 'undefined' && document.getElementById(BRANDING_STYLE_ID)) {
        return null;
    }
    return (
        <style id={BRANDING_STYLE_ID}>{`
[data-vendure-branding] {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    height: auto !important;
    overflow: visible !important;
    max-height: none !important;
    position: relative !important;
}`}</style>
    );
}

function VendureBranding({ className }: Readonly<{ className?: string }>) {
    return (
        <>
            <BrandingStyle />
            <div
                data-vendure-branding=""
                className={`flex items-center justify-center gap-1.5 text-muted-foreground ${className ?? ''}`}
            >
                <IconMark className="h-3 w-3.5 shrink-0" />
                <span className="text-xs leading-none whitespace-nowrap">
                    Vendure{' '}
                    <span className="opacity-60">v{uiConfig.version}</span>
                </span>
            </div>
        </>
    );
}

export function MenuBranding() {
    return <VendureBranding className="px-2 py-1.5" />;
}

export function LoginBranding() {
    return <VendureBranding className="pt-6" />;
}
