import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/vdb/components/ui/collapsible.js';
import { DropdownMenuItem } from '@/vdb/components/ui/dropdown-menu.js';
import type { DashboardActionBarItem } from '@/vdb/framework/extension-api/types/layout.js';
import {
    getLockedPageActions,
    type LockedPageCard,
} from '@/vdb/framework/platform-promotion/locked-capabilities.js';
import { usePlatformPromotion } from '@/vdb/hooks/use-platform-promotion.js';
import { Plural, Trans } from '@lingui/react/macro';
import { ChevronRight, Lock } from 'lucide-react';
import { ReactNode, useMemo, useState } from 'react';

import { PlatformPromoDialog, PlatformPromoEntry, PlatformPromoList } from './platform-promo.js';

function CardSummary({ pageId, card }: Readonly<{ pageId: string | undefined; card: LockedPageCard }>) {
    const count = card.capabilities.length;
    const names = card.capabilities.map(c => c.title).join(', ');
    switch (pageId) {
        case 'order-detail':
            return (
                <Plural
                    value={count}
                    one={`# more for orders with Vendure Platform: ${names}`}
                    other={`# more for orders with Vendure Platform: ${names}`}
                />
            );
        case 'product-detail':
        case 'product-variant-detail':
        case 'product-list':
            return (
                <Plural
                    value={count}
                    one={`# more for products with Vendure Platform: ${names}`}
                    other={`# more for products with Vendure Platform: ${names}`}
                />
            );
        case 'customer-detail':
            return (
                <Plural
                    value={count}
                    one={`# more for customers with Vendure Platform: ${names}`}
                    other={`# more for customers with Vendure Platform: ${names}`}
                />
            );
        case 'collection-detail':
            return (
                <Plural
                    value={count}
                    one={`# more for collections with Vendure Platform: ${names}`}
                    other={`# more for collections with Vendure Platform: ${names}`}
                />
            );
        case 'role-detail':
            return (
                <Plural
                    value={count}
                    one={`# more for roles with Vendure Platform: ${names}`}
                    other={`# more for roles with Vendure Platform: ${names}`}
                />
            );
        default:
            return (
                <Plural
                    value={count}
                    one={`# more with Vendure Platform: ${names}`}
                    other={`# more with Vendure Platform: ${names}`}
                />
            );
    }
}

/**
 * One compact card per OSS page for the locked capabilities which put page blocks on that
 * page. It is collapsed at first. An entry opens the promo overlay.
 */
export function PlatformPromotionPageCard({
    pageId,
    card,
}: Readonly<{
    pageId: string | undefined;
    card: LockedPageCard;
    // Read by PageLayout to place the card in its column.
    column: 'main' | 'side';
    blockId: string;
}>) {
    const [selected, setSelected] = useState<PlatformPromoEntry>();
    // Separate from `selected`, so the dialog keeps its content while it fades out.
    const [dialogOpen, setDialogOpen] = useState(false);
    const entries = card.capabilities.map(promotion => ({ label: promotion.title, promotion }));
    return (
        <Card className="w-full animate-in fade-in duration-300">
            <CardContent>
                <Collapsible data-testid="platform-promotion-page-card">
                    <CollapsibleTrigger className="group/promo flex w-full items-center gap-2 text-start text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                        <Lock className="size-4 shrink-0" aria-hidden="true" />
                        <span className="flex-1">
                            <CardSummary pageId={pageId} card={card} />
                        </span>
                        <ChevronRight
                            className="size-4 shrink-0 transition-transform group-data-[panel-open]/promo:rotate-90 rtl:rotate-180"
                            aria-hidden="true"
                        />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <div className="pt-3">
                            <PlatformPromoList
                                entries={entries}
                                onSelect={entry => {
                                    setSelected(entry);
                                    setDialogOpen(true);
                                }}
                            />
                        </div>
                    </CollapsibleContent>
                </Collapsible>
                <PlatformPromoDialog
                    entries={selected ? [selected] : []}
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                />
            </CardContent>
        </Card>
    );
}

/**
 * The "More with Platform" entry for the action menu of a page, and the overlay it opens.
 * The overlay is outside the menu, so it stays open when the menu closes.
 */
export function usePlatformPromotionActionItem(pageId: string | undefined): {
    item: DashboardActionBarItem | undefined;
    dialog: ReactNode;
} {
    const state = usePlatformPromotion();
    const [open, setOpen] = useState(false);
    const actions = useMemo(() => getLockedPageActions(state, pageId), [state, pageId]);
    const item = useMemo<DashboardActionBarItem | undefined>(
        () =>
            actions.length
                ? {
                      id: 'platform-promotion',
                      pageId: pageId ?? '',
                      type: 'dropdown',
                      component: () => (
                          <DropdownMenuItem
                              onClick={() => setOpen(true)}
                              data-testid="platform-promotion-action"
                          >
                              <Lock aria-hidden="true" />
                              <Trans>More with Platform</Trans>
                          </DropdownMenuItem>
                      ),
                  }
                : undefined,
        [actions.length, pageId],
    );
    return {
        item,
        dialog: actions.length ? (
            <PlatformPromoDialog entries={actions} open={open} onOpenChange={setOpen} />
        ) : null,
    };
}
