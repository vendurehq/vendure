import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '@/vdb/components/ui/dialog.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import {
    getPromotionUrl,
    isLocalhost,
    isUpgrade,
} from '@/vdb/framework/platform-promotion/locked-capabilities.js';
import type {
    DashboardPromotionCapabilityV1,
    PlatformTier,
} from '@/vdb/framework/platform-promotion/platform-promotion-types.js';
import { usePlatformPromotion } from '@/vdb/hooks/use-platform-promotion.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowLeft, Check, ChevronRight, Lock } from 'lucide-react';
import { useState } from 'react';

export const VENDURE_ADD_COMMAND = 'npx vendure add';

export function useTierLabel() {
    const { t } = useLingui();
    const labels: Record<PlatformTier, string> = {
        starter: t({ message: 'Starter', context: 'Vendure Platform plan name' }),
        growth: t({ message: 'Growth', context: 'Vendure Platform plan name' }),
        scale: t({ message: 'Scale', context: 'Vendure Platform plan name' }),
        enterprise: t({ message: 'Enterprise', context: 'Vendure Platform plan name' }),
    };
    return (tier: PlatformTier) => labels[tier] ?? tier;
}

/**
 * The lock icon and tier label of a locked entry. With a partial grant it reads
 * "Upgrade to <tier>".
 */
export function LockedTierLabel({
    promotion,
    className,
}: Readonly<{ promotion: DashboardPromotionCapabilityV1; className?: string }>) {
    const state = usePlatformPromotion();
    const tierLabel = useTierLabel()(promotion.tier);
    return (
        <span
            className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
            data-testid="locked-tier-label"
        >
            <Lock className="size-3 shrink-0" aria-hidden="true" />
            {isUpgrade(state) ? <Trans>Upgrade to {tierLabel}</Trans> : tierLabel}
        </span>
    );
}

/**
 * The lock icon of a locked nav item, in a fixed-width slot at the end of the row. The tier,
 * or "Upgrade to <tier>" with a partial grant, shows in a tooltip.
 */
export function LockedNavIcon({ promotion }: Readonly<{ promotion: DashboardPromotionCapabilityV1 }>) {
    const state = usePlatformPromotion();
    const tierLabel = useTierLabel()(promotion.tier);
    const text = isUpgrade(state) ? <Trans>Upgrade to {tierLabel}</Trans> : <Trans>{tierLabel} plan</Trans>;
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        className="ms-auto flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                        data-testid="locked-nav-icon"
                    />
                }
            >
                <Lock className="size-3" aria-hidden="true" />
                <span className="sr-only">{text}</span>
            </TooltipTrigger>
            <TooltipContent side="right">{text}</TooltipContent>
        </Tooltip>
    );
}

/** The promo content of the overlay: title, tier, summary, benefits and the actions. */
export function PlatformPromoPanel({ promotion }: Readonly<{ promotion: DashboardPromotionCapabilityV1 }>) {
    const state = usePlatformPromotion();
    const tierLabel = useTierLabel()(promotion.tier);
    const href = getPromotionUrl(promotion);
    const showCommand = promotion.cta === 'trial' && isLocalhost(window.location.hostname);
    return (
        <div className="space-y-4" data-testid="platform-promo-panel">
            <div className="space-y-2">
                <Badge variant="outline">
                    <Lock className="size-3" aria-hidden="true" />
                    <Trans>{tierLabel} plan</Trans>
                </Badge>
                <h2 className="text-lg font-semibold">{promotion.title}</h2>
                <p className="text-sm text-muted-foreground">{promotion.summary}</p>
            </div>
            <ul className="space-y-2 text-sm">
                {promotion.benefits.map(benefit => (
                    <li key={benefit} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>{benefit}</span>
                    </li>
                ))}
            </ul>
            <div className="space-y-3">
                <Button
                    className="w-full"
                    render={<a href={href} target="_blank" rel="noopener noreferrer" />}
                    data-testid="platform-promo-cta"
                >
                    {promotion.cta === 'sales' ? (
                        <Trans>Talk to sales</Trans>
                    ) : isUpgrade(state) ? (
                        <Trans>Upgrade to {tierLabel}</Trans>
                    ) : (
                        <Trans>Start free trial</Trans>
                    )}
                </Button>
                {showCommand ? (
                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                            <Trans>Or add it to this project:</Trans>
                        </p>
                        <CopyableText
                            value={VENDURE_ADD_COMMAND}
                            className="flex items-center justify-between rounded-md border bg-muted px-3 py-2"
                        >
                            <code className="font-mono text-sm">{VENDURE_ADD_COMMAND}</code>
                        </CopyableText>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export interface PlatformPromoEntry {
    label: string;
    promotion: DashboardPromotionCapabilityV1;
}

/**
 * Opens the promo overlay. With one entry it shows the promo at once. With more entries it
 * first lists them.
 */
export function PlatformPromoDialog({
    entries,
    open,
    onOpenChange,
}: Readonly<{
    entries: PlatformPromoEntry[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}>) {
    const [selected, setSelected] = useState<PlatformPromoEntry>();
    const current = entries.length === 1 ? entries[0] : selected;
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            // Go back to the list only after the close animation, so the content does not change
            // while the dialog fades out.
            onOpenChangeComplete={value => !value && setSelected(undefined)}
        >
            <DialogContent className="sm:max-w-md">
                {current ? (
                    <>
                        <DialogTitle className="sr-only">{current.promotion.title}</DialogTitle>
                        {entries.length > 1 ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-fit"
                                onClick={() => setSelected(undefined)}
                            >
                                <ArrowLeft className="size-4" aria-hidden="true" />
                                <Trans>Back</Trans>
                            </Button>
                        ) : null}
                        <PlatformPromoPanel promotion={current.promotion} />
                    </>
                ) : (
                    <>
                        <DialogTitle>
                            <Trans>More with Vendure Platform</Trans>
                        </DialogTitle>
                        <PlatformPromoList entries={entries} onSelect={setSelected} />
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

export function PlatformPromoList({
    entries,
    onSelect,
}: Readonly<{ entries: PlatformPromoEntry[]; onSelect: (entry: PlatformPromoEntry) => void }>) {
    return (
        <ul className="divide-y rounded-md border">
            {entries.map(entry => (
                <li key={entry.label}>
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onSelect(entry)}
                    >
                        <span className="flex-1">{entry.label}</span>
                        <LockedTierLabel promotion={entry.promotion} />
                        <ChevronRight
                            className="size-4 text-muted-foreground rtl:rotate-180"
                            aria-hidden="true"
                        />
                    </button>
                </li>
            ))}
        </ul>
    );
}
