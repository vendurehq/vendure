import {
    PlatformPromotionPageCard,
    usePlatformPromotionActionItem,
} from '@/vdb/components/platform-promotion/platform-promotion-page-card.js';
import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { FormErrorSummary } from '@/vdb/components/shared/form-error-summary.js';
import { NavigationConfirmation } from '@/vdb/components/shared/navigation-confirmation.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/vdb/components/ui/card.js';
import {
    DescriptionDetail,
    DescriptionItem,
    DescriptionList,
    DescriptionTerm,
} from '@/vdb/components/ui/description-list.js';
import { Form } from '@/vdb/components/ui/form.js';
import { IdChip } from '@/vdb/components/ui/id-chip.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useIsMobile } from '@/vdb/hooks/use-mobile.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { usePlatformPromotion } from '@/vdb/hooks/use-platform-promotion.js';
import { useIsServerConfigLoaded } from '@/vdb/hooks/use-server-config.js';
import { cn } from '@/vdb/lib/utils.js';
import { MoreHorizontalIcon } from 'lucide-react';
import React, { ComponentProps, useMemo } from 'react';
import { Control, UseFormReturn } from 'react-hook-form';

import { ActionBarItemPosition, DashboardActionBarItem } from '../extension-api/types/layout.js';
import { ActionBarItem, ActionBarItemProps, ActionBarItemWrapper } from './action-bar-item-wrapper.js';

import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import {
    PageHeader,
    PageHeaderActions,
    PageHeaderContent,
    PageHeaderTitle,
} from '@/vdb/components/ui/page-header.js';
import { PageBlockContext } from '@/vdb/framework/layout-engine/page-block-provider.js';
import { PageContext, PageContextValue } from '@/vdb/framework/layout-engine/page-provider.js';
import { useIsPageSkeleton } from '@/vdb/hooks/use-is-page-skeleton.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { getLockedPageCard } from '../platform-promotion/locked-capabilities.js';
import { getDashboardActionBarItems, getDashboardPageBlocks } from './layout-extensions.js';
import { LocationWrapper } from './location-wrapper.js';

/**
 * @description
 * The props used to configure the {@link Page} component.
 *
 * @docsCategory page-layout
 * @docsPage Page
 * @since 3.3.0
 */
export interface PageProps extends ComponentProps<'div'> {
    /**
     * @description
     * A string identifier for the page, e.g. "product-list", "review-detail", etc.
     */
    pageId?: string;

    entity?: any;
    form?: UseFormReturn<any>;
    submitHandler?: any;
}

/**
 * @description
 * This component should be used to wrap _all_ pages in the dashboard. It provides
 * a consistent layout as well as a context for the slot-based PageBlock system.
 *
 * The typical hierarchy of a page is as follows:
 * - `Page`
 *  - {@link PageTitle}
 *  - {@link PageActionBar}
 *  - {@link PageLayout}
 *
 * @example
 * ```tsx
 * import { Page, PageTitle, PageActionBar, PageLayout, PageBlock, Button } from '\@vendure/dashboard';
 *
 * const pageId = 'my-page';
 *
 * export function MyPage() {
 *  return (
 *    <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
 *      <PageTitle>My Page</PageTitle>
 *      <PageActionBar>
 *        <ActionBarItem itemId="save-button">
 *          <Button>Save</Button>
 *        </ActionBarItem>
 *      </PageActionBar>
 *      <PageLayout>
 *        <PageBlock column="main" blockId="my-block">
 *          <div>My Block</div>
 *        </PageBlock>
 *      </PageLayout>
 *    </Page>
 *  )
 * }
 * ```
 *
 * @docsCategory page-layout
 * @docsPage Page
 * @docsWeight 0
 * @since 3.3.0
 */
export function Page({ children, pageId, entity, form, submitHandler, ...props }: Readonly<PageProps>) {
    const childArray = React.Children.toArray(children);

    const pageTitle = childArray.find(child => isOfType(child, PageTitle));
    const pageActionBar = childArray.find(child => isOfType(child, PageActionBar));

    const pageContent = childArray.filter(
        child => !isOfType(child, PageTitle) && !isOfType(child, PageActionBar),
    );

    const pageHeader = (
        <PageHeader className="items-center">
            <PageHeaderContent>{pageTitle ?? <div />}</PageHeaderContent>
            {pageActionBar && <PageHeaderActions>{pageActionBar}</PageHeaderActions>}
        </PageHeader>
    );

    return (
        <PageContext.Provider value={{ pageId, form, entity }}>
            <PageContent
                pageHeader={pageHeader}
                pageContent={pageContent}
                form={form}
                submitHandler={submitHandler}
                {...props}
            />
        </PageContext.Provider>
    );
}

function PageContent({
    pageHeader,
    pageContent,
    form,
    submitHandler,
    ...props
}: {
    pageHeader: React.ReactNode;
    pageContent: React.ReactNode;
    form?: UseFormReturn<any>;
    submitHandler?: any;
    className?: string;
}) {
    return (
        <div className={cn('m-4', props.className)} {...props}>
            <LocationWrapper>
                <PageContentWithOptionalForm
                    pageHeader={pageHeader}
                    pageContent={pageContent}
                    form={form}
                    submitHandler={submitHandler}
                />
            </LocationWrapper>
        </div>
    );
}

export function PageContentWithOptionalForm({
    form,
    pageHeader,
    pageContent,
    submitHandler,
}: {
    form?: UseFormReturn<any>;
    pageHeader: React.ReactNode;
    pageContent: React.ReactNode;
    submitHandler?: any;
}) {
    return form ? (
        <Form {...form}>
            <NavigationConfirmation form={form} />
            <form onSubmit={submitHandler} className="space-y-4">
                {pageHeader}
                <FormErrorSummary form={form} />
                {pageContent}
            </form>
        </Form>
    ) : (
        <div className="space-y-4">
            {pageHeader}
            {pageContent}
        </div>
    );
}

/**
 * @description
 * **Status: Developer Preview**
 *
 * @docsCategory page-layout
 * @docsPage PageLayout
 * @since 3.3.0
 */
export type PageLayoutProps = {
    children: React.ReactNode;
    className?: string;
};

function isPageBlock(child: unknown): child is React.ReactElement<PageBlockProps> {
    if (!child) {
        return false;
    }
    if (!React.isValidElement(child)) {
        return false;
    }
    const props = (child as React.ReactElement<PageBlockProps>).props;
    const hasColumn = 'column' in props;
    const hasBlockId = 'blockId' in props;
    return hasColumn || hasBlockId;
}

// Single source of truth for which column a block belongs to. `FullWidthPageBlock` is
// identified by type since it doesn't declare a `column` prop; everything else is keyed
// off the `column` prop. Keep all bucketing in `PageLayout` going through this.
function getBlockColumn(child: React.ReactElement<PageBlockProps>): 'main' | 'side' | 'full' {
    if (isOfType(child, FullWidthPageBlock)) {
        return 'full';
    }
    return child.props.column;
}

/**
 * @description *
 * This component governs the layout of the contents of a {@link Page} component.
 * It should contain all the {@link PageBlock} components that are to be displayed on the page.
 *
 * @docsCategory page-layout
 * @docsPage PageLayout
 * @docsWeight 0
 * @since 3.3.0
 */
export function PageLayout({ children, className }: Readonly<PageLayoutProps>) {
    const page = usePage();
    const isMobile = useIsMobile();
    // Separate blocks into categories
    const childArray: React.ReactElement<PageBlockProps>[] = [];
    const extensionBlocks = getDashboardPageBlocks(page.pageId ?? '');
    const { hasPermissions } = usePermissions();
    const lockedPageCard = getLockedPageCard(usePlatformPromotion(), page.pageId);
    // In the skeleton of a loading page there is no entity yet: an extension block
    // shows as a skeleton card, and one that decides from the entity whether to
    // render does not show.
    const isSkeleton = useIsPageSkeleton();
    React.Children.forEach(children, child => {
        if (isPageBlock(child)) {
            childArray.push(child);
        }
        // check for a React Fragment
        if (React.isValidElement(child) && child.type === React.Fragment) {
            React.Children.forEach((child as React.ReactElement<PageBlockProps>).props.children, child => {
                if (isPageBlock(child)) {
                    childArray.push(child);
                }
            });
        }
    });

    const finalChildArray: React.ReactElement<PageBlockProps>[] = [];
    for (const childBlock of childArray) {
        if (childBlock) {
            const blockId =
                childBlock.props.blockId ??
                (isOfType(childBlock, CustomFieldsPageBlock) ? 'custom-fields' : undefined);

            // Get all extension blocks with the same position blockId
            const matchingExtensionBlocks = extensionBlocks.filter(
                block => block.location.position.blockId === blockId,
            );

            // sort the blocks to make sure we have the correct order
            const arrangedExtensionBlocks = matchingExtensionBlocks.sort((a, b) => {
                const orderPriority = { before: 1, replace: 2, after: 3 };
                return orderPriority[a.location.position.order] - orderPriority[b.location.position.order];
            });

            type ExtensionBlockEntry = (typeof arrangedExtensionBlocks)[number];

            // using `hasPermissions` over `PermissionGuard` as this would defeat the `isPageBlock` typeguard
            const willBlockRender = (
                block: ExtensionBlockEntry,
            ): block is ExtensionBlockEntry & {
                component: NonNullable<ExtensionBlockEntry['component']>;
            } => {
                if (!block.component) return false;
                if (typeof block.shouldRender === 'function' && (isSkeleton || !block.shouldRender(page))) {
                    return false;
                }
                const required = block.requiresPermission ?? [];
                return hasPermissions(Array.isArray(required) ? required : [required]);
            };

            // A `replace`-ordered block only counts as a replacement when it would actually render —
            // otherwise the original child must be kept as a fallback.
            const replacementBlockExists = arrangedExtensionBlocks.some(
                block => block.location.position.order === 'replace' && willBlockRender(block),
            );

            let childBlockInserted = false;
            if (matchingExtensionBlocks.length > 0) {
                for (const extensionBlock of arrangedExtensionBlocks) {
                    // Insert child block before the first non-"before" block
                    if (
                        !childBlockInserted &&
                        !replacementBlockExists &&
                        extensionBlock.location.position.order !== 'before'
                    ) {
                        finalChildArray.push(childBlock);
                        childBlockInserted = true;
                    }

                    if (!willBlockRender(extensionBlock)) continue;

                    const isFullWidth = extensionBlock.location.column === 'full';
                    const BlockComponent = isFullWidth ? FullWidthPageBlock : PageBlock;

                    finalChildArray.push(
                        <BlockComponent
                            key={extensionBlock.id}
                            column={extensionBlock.location.column}
                            blockId={extensionBlock.id}
                            title={
                                isSkeleton && extensionBlock.title ? (
                                    <Skeleton className="h-[1lh] w-28" />
                                ) : (
                                    extensionBlock.title
                                )
                            }
                            description={
                                isSkeleton && extensionBlock.description ? (
                                    <Skeleton className="h-[1lh] w-48" />
                                ) : (
                                    extensionBlock.description
                                )
                            }
                        >
                            {isSkeleton ? (
                                <ExtensionBlockSkeleton />
                            ) : (
                                <extensionBlock.component context={page} />
                            )}
                        </BlockComponent>,
                    );
                }

                // If all blocks were "before", insert child block at the end
                if (!childBlockInserted && !replacementBlockExists) {
                    finalChildArray.push(childBlock);
                }
            } else {
                finalChildArray.push(childBlock);
            }
        }
    }

    // The card for locked Platform blocks goes at the bottom of its column.
    if (lockedPageCard) {
        finalChildArray.push(
            <PlatformPromotionPageCard
                key="platform-promotion"
                pageId={page.pageId}
                card={lockedPageCard}
                column={lockedPageCard.column}
                blockId="platform-promotion"
            />,
        );
    }

    const fullWidthBlocks = finalChildArray.filter(
        child => isPageBlock(child) && getBlockColumn(child) === 'full',
    );
    const mainBlocks = finalChildArray.filter(
        child => isPageBlock(child) && getBlockColumn(child) === 'main',
    );
    const sideBlocks = finalChildArray.filter(
        child => isPageBlock(child) && getBlockColumn(child) === 'side',
    );

    return (
        <div className={cn('w-full space-y-4', className, '@container/layout')}>
            {isMobile ? (
                <div className="space-y-4">{finalChildArray}</div>
            ) : (
                <div className="grid grid-cols-1 gap-4 @3xl/layout:grid-cols-4">
                    {fullWidthBlocks.length > 0 && (
                        <div className="@md/layout:col-span-5 space-y-4">{fullWidthBlocks}</div>
                    )}
                    <div className="@3xl/layout:col-span-3 space-y-4">{mainBlocks}</div>
                    <div className="@3xl/layout:col-span-1 space-y-4">{sideBlocks}</div>
                </div>
            )}
        </div>
    );
}

/**
 * An extension block in the skeleton of a loading page.
 */
function ExtensionBlockSkeleton() {
    return (
        <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
        </div>
    );
}

export function DetailFormGrid({ children }: Readonly<{ children: React.ReactNode }>) {
    return <div className="grid @md:grid-cols-2 gap-6 items-start mb-6">{children}</div>;
}

/**
 * @description
 * A component for displaying the title of a page. This should be used inside the {@link Page} component.
 *
 * @docsCategory page-layout
 * @docsPage PageTitle
 * @since 3.3.0
 */
export function PageTitle({ children }: Readonly<{ children: React.ReactNode }>) {
    return <PageHeaderTitle data-testid="page-heading">{children}</PageHeaderTitle>;
}

export type InlineDropdownItem = Omit<DashboardActionBarItem, 'type' | 'pageId'>;

/**
 * @description
 * A component for displaying the main actions for a page. This should be used inside the {@link Page} component.
 *
 * You can add action bar items by including {@link ActionBarItem} components as direct children.
 *
 * **Mobile behavior:** On mobile viewports, only the last inline {@link ActionBarItem} is
 * shown (the primary action). Extension items and plain children are hidden to prevent
 * overflow. The dropdown menu and entity info remain visible on all viewports.
 *
 * @example
 * ```tsx
 * <PageActionBar>
 *     <ActionBarItem itemId="save-button" requiresPermission={['UpdateProduct']}>
 *         <Button type="submit">Update</Button>
 *     </ActionBarItem>
 * </PageActionBar>
 * ```
 *
 * @docsCategory page-layout
 * @docsPage PageActionBar
 * @docsWeight 0
 * @since 3.3.0
 */
export function PageActionBar({
    children,
    dropdownMenuItems,
}: Readonly<{
    children: React.ReactNode;
    /**
     * @description
     * Optional dropdown menu items to display in the action bar's context menu.
     */
    dropdownMenuItems?: InlineDropdownItem[];
}>) {
    const page = usePage();
    const actionBarItems = page.pageId ? getDashboardActionBarItems(page.pageId) : [];
    const platformPromotionAction = usePlatformPromotionActionItem(page.pageId);
    const childArray = React.Children.toArray(children);

    // Collect ActionBarItem children, and plain children (buttons etc.) which are not ActionBarItems
    const actionBarItemChildren: React.ReactElement<ActionBarItemProps>[] = [];
    const plainChildren: React.ReactNode[] = [];
    childArray.forEach(child => {
        if (isActionBarItem(child)) {
            actionBarItemChildren.push(child);
        } else {
            plainChildren.push(child);
        }
    });

    // Separate button items from dropdown items
    const extensionButtonItems = actionBarItems.filter(item => item.type !== 'dropdown');
    const actionBarDropdownItems = [
        ...(dropdownMenuItems ?? []).map(item => ({
            ...item,
            pageId: page.pageId ?? '',
            type: 'dropdown' as const,
        })),
        ...actionBarItems.filter(item => item.type === 'dropdown'),
        ...(platformPromotionAction.item ? [platformPromotionAction.item] : []),
    ];

    // Merge and sort inline items with extension items
    const mergedItems = mergeAndSortActionBarItems(actionBarItemChildren, extensionButtonItems);

    const isMobile = useIsMobile();

    // Determine if we should render the right section
    const hasRightContent =
        mergedItems.length > 0 ||
        plainChildren.length > 0 ||
        actionBarDropdownItems.length > 0 ||
        page.entity;

    // On mobile, show only the primary inline action (e.g. Update/Save/Create)
    // and hide extensions + plain children to prevent overflow
    let primaryItemIndex = -1;
    for (let i = mergedItems.length - 1; i >= 0; i--) {
        if (mergedItems[i].type === 'inline') {
            primaryItemIndex = i;
            break;
        }
    }
    let visibleMergedItems = mergedItems;
    if (isMobile && mergedItems.length >= 2) {
        visibleMergedItems =
            primaryItemIndex >= 0 ? [mergedItems[primaryItemIndex]] : [mergedItems[mergedItems.length - 1]];
    }

    // When the page provides its own actions, the primary slot is taken (e.g. Update/Save),
    // so extension buttons are demoted and may not render as primary. Checks mergedItems
    // rather than the raw children so that an extension which *replaces* the page action
    // is allowed to take over its primary styling.
    const hasPageProvidedActions =
        mergedItems.some(mergedItem => mergedItem.type === 'inline') || plainChildren.length > 0;

    const renderMergedItem = (mergedItem: MergedActionBarItem, index: number) => {
        if (mergedItem.type === 'inline') {
            return React.cloneElement(mergedItem.element, {
                key: `inline-${mergedItem.element.props.itemId}`,
            });
        } else {
            const extItem = mergedItem.item;
            const itemId = extItem.id ?? `extension-${extItem.component.name || index}`;
            return (
                <ActionBarItemWrapper
                    key={`ext-${extItem.id ?? extItem.pageId}-${index}`}
                    itemId={itemId}
                    demotePrimary={hasPageProvidedActions}
                >
                    <PageActionBarItem item={extItem} page={page} />
                </ActionBarItemWrapper>
            );
        }
    };

    return (
        <div className="flex justify-end gap-2">
            {hasRightContent && (
                <div className="flex justify-end gap-2">
                    {/* Plain children only on desktop */}
                    {!isMobile &&
                        plainChildren.map((child, index) => (
                            <React.Fragment key={`plain-${index}`}>{child}</React.Fragment>
                        ))}
                    {/* Merged ActionBarItem children (filtered on mobile) */}
                    {visibleMergedItems.map((mergedItem, index) => renderMergedItem(mergedItem, index))}
                    <PageActionBarMenu items={actionBarDropdownItems} page={page} />
                </div>
            )}
            {platformPromotionAction.dialog}
        </div>
    );
}

/**
 * Checks if a React child is an ActionBarItem component.
 */
function isActionBarItem(child: unknown): child is React.ReactElement<ActionBarItemProps> {
    return React.isValidElement(child) && isOfType(child, ActionBarItem);
}

/**
 * Represents a merged action bar item that can be either inline (ActionBarItem child) or from an extension.
 * Used internally for sorting and rendering.
 */
type MergedActionBarItem =
    | { type: 'inline'; element: React.ReactElement<ActionBarItemProps> }
    | { type: 'extension'; item: DashboardActionBarItem };

type PositionedExtensionActionBarItem = {
    type: 'extension';
    item: DashboardActionBarItem & { position: ActionBarItemPosition };
};

function isPositionedExtensionActionBarItem(
    item: MergedActionBarItem,
): item is PositionedExtensionActionBarItem {
    return item.type === 'extension' && !!item.item.position;
}

/**
 * Merges inline ActionBarItem children with extension items, applying position-based ordering.
 * Uses the same priority sorting as page blocks: before=1, replace=2, after=3.
 */
function mergeAndSortActionBarItems(
    inlineElements: React.ReactElement<ActionBarItemProps>[],
    extensionItems: DashboardActionBarItem[],
): MergedActionBarItem[] {
    const result: MergedActionBarItem[] = [];

    // Treat inline ActionBarItem children and extension items as the same kind of sortable node.
    // This lets position.itemId target either an inline ActionBarItem.itemId or another extension item's id.
    const inlineItems: MergedActionBarItem[] = inlineElements.map(element => ({ type: 'inline', element }));
    const extensionActionItems: MergedActionBarItem[] = extensionItems.map(item => ({
        type: 'extension',
        item,
    }));
    const getItemId = (item: MergedActionBarItem): string | undefined =>
        item.type === 'inline' ? item.element.props.itemId : item.item.id;

    // Sort by order priority: before=1, replace=2, after=3
    const orderPriority: Record<ActionBarItemPosition['order'], number> = {
        before: 1,
        replace: 2,
        after: 3,
    };

    // First, use extension items WITHOUT a position as root items (they still go first,
    // preserving the previous behavior). Inline items are also root items.
    const rootItems = [
        ...extensionActionItems.filter(item => !isPositionedExtensionActionBarItem(item)),
        ...inlineItems,
    ];

    // Group positioned extension items by their target id. The target id may refer to either
    // an inline ActionBarItem.itemId or a DashboardActionBarItem.id.
    const extensionsByTargetId = new Map<string, PositionedExtensionActionBarItem[]>();

    for (const item of extensionActionItems.filter(isPositionedExtensionActionBarItem)) {
        const targetItems = extensionsByTargetId.get(item.item.position.itemId) ?? [];
        extensionsByTargetId.set(item.item.position.itemId, [...targetItems, item]);
    }

    const renderedExtensionItems = new Set<DashboardActionBarItem>();

    function renderItem(item: MergedActionBarItem) {
        // Prevent duplicate rendering if multiple paths reference the same extension item.
        if (item.type === 'extension') {
            if (renderedExtensionItems.has(item.item)) {
                return;
            }
            renderedExtensionItems.add(item.item);
        }

        const itemId = getItemId(item);
        const extensions = itemId
            ? [...(extensionsByTargetId.get(itemId) ?? [])].sort((a, b) => {
                  return orderPriority[a.item.position.order] - orderPriority[b.item.position.order];
              })
            : [];
        const hasReplacement = extensions.some(ext => ext.item.position.order === 'replace');

        // Render positioned items in before / replace / after order around their target.
        for (const extension of extensions.filter(ext => ext.item.position.order === 'before')) {
            renderItem(extension);
        }

        if (hasReplacement) {
            for (const extension of extensions.filter(ext => ext.item.position.order === 'replace')) {
                renderItem(extension);
            }
        } else {
            result.push(item);
        }

        for (const extension of extensions.filter(ext => ext.item.position.order === 'after')) {
            renderItem(extension);
        }
    }

    for (const item of rootItems) {
        renderItem(item);
    }

    // A positioned extension can be unreachable from the root walk if its target id is
    // missing, or if positioned extensions only reference each other in a cycle. Render
    // any remaining extension items so they do not silently disappear.
    for (const item of extensionActionItems) {
        if (item.type === 'extension' && !renderedExtensionItems.has(item.item)) {
            renderItem(item);
        }
    }

    return result;
}

function PageActionBarItem({
    item,
    page,
}: Readonly<{ item: DashboardActionBarItem; page: PageContextValue }>) {
    return (
        <PermissionGuard requires={item.requiresPermission ?? []}>
            <item.component context={page} />
        </PermissionGuard>
    );
}

/**
 * The ⋯ menu at the end of the action bar. It holds the page's rare actions (inline
 * `dropdownMenuItems` and extension dropdown items) and, below them, the ID and dates
 * of the page entity.
 */
function PageActionBarMenu({
    items,
    page,
}: Readonly<{ items: DashboardActionBarItem[]; page: PageContextValue }>) {
    const { hasPermissions } = usePermissions();
    const { formatDate } = useLocalFormat();
    const { t } = useLingui();
    // Filter by permission up front so an under-permissioned user never sees an
    // empty menu. Items without a `requiresPermission` are always visible.
    const visibleItems = items.filter(item => {
        const required = item.requiresPermission ?? [];
        return hasPermissions(Array.isArray(required) ? required : [required]);
    });
    const entity = page.entity;
    const hasEntityInfo = !!entity?.id;

    if (visibleItems.length === 0 && !hasEntityInfo) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t`More actions`}
                        data-testid="action-bar-dropdown-trigger"
                    />
                }
            >
                <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56">
                {visibleItems.map((item, index) => (
                    <item.component key={item.pageId + index} context={page} />
                ))}
                {visibleItems.length > 0 && hasEntityInfo && <DropdownMenuSeparator />}
                {hasEntityInfo && (
                    <DropdownMenuGroup data-testid="entity-info">
                        <DropdownMenuLabel>
                            <Trans>Entity information</Trans>
                        </DropdownMenuLabel>
                        <DescriptionList
                            orientation="horizontal"
                            className="items-center gap-x-4 gap-y-1.5 px-2 pb-1.5"
                        >
                            <DescriptionItem>
                                <DescriptionTerm>ID</DescriptionTerm>
                                <DescriptionDetail className="justify-self-end">
                                    <IdChip
                                        value={String(entity.id)}
                                        copyLabel={t`Copy ID`}
                                        copiedLabel={t`Copied`}
                                    />
                                </DescriptionDetail>
                            </DescriptionItem>
                            {entity.createdAt && (
                                <DescriptionItem>
                                    <DescriptionTerm>
                                        <Trans>Created</Trans>
                                    </DescriptionTerm>
                                    <DescriptionDetail className="justify-self-end tabular-nums">
                                        {formatDate(entity.createdAt)}
                                    </DescriptionDetail>
                                </DescriptionItem>
                            )}
                            {entity.updatedAt && (
                                <DescriptionItem>
                                    <DescriptionTerm>
                                        <Trans>Updated</Trans>
                                    </DescriptionTerm>
                                    <DescriptionDetail className="justify-self-end tabular-nums">
                                        {formatDate(entity.updatedAt)}
                                    </DescriptionDetail>
                                </DescriptionItem>
                            )}
                        </DescriptionList>
                    </DropdownMenuGroup>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * @description
 * Props used to configure the {@link PageBlock} component.
 *
 * @docsCategory page-layout
 * @docsPage PageBlock
 * @since 3.3.0
 */
export type PageBlockProps = {
    /**
     * @description
     * The content of the block.
     */
    children?: React.ReactNode;
    /**
     * @description
     * Which column this block should appear in
     */
    column: 'main' | 'side' | 'full';
    /**
     * @description
     * The ID of the block, e.g. "gift-cards" or "related-products".
     */
    blockId?: string;
    /**
     * @description
     * The title of the block, e.g. "Gift Cards" or "Related Products".
     */
    title?: React.ReactNode | string;
    /**
     * @description
     * An optional description of the block.
     */
    description?: React.ReactNode | string;
    /**
     * @description
     * An optional set of CSS classes to apply to the block.
     */
    className?: string;
    /**
     * @description
     * The visual treatment of the block. The default `'card'` wraps the content
     * in a Card. Use `'bare'` for content that provides its own surface — such as
     * a `DataTable` — to avoid a box-in-box appearance. In the bare layout the
     * title and description are rendered as a heading above the content.
     *
     * @default 'card'
     * @since 3.8.0
     */
    layout?: 'card' | 'bare';
};

/**
 * @description *
 * A component for displaying a block of content on a page. This should be used inside the {@link PageLayout} component.
 * It should be provided with a `column` prop to determine which column it should appear in, and a `blockId` prop
 * to identify the block.
 *
 * @example
 * ```tsx
 * <PageBlock column="main" blockId="my-block">
 *  <div>My Block</div>
 * </PageBlock>
 * ```
 *
 * @docsCategory page-layout
 * @docsPage PageBlock
 * @docsWeight 0
 * @since 3.3.0
 */
export function PageBlock({
    children,
    title,
    description,
    className,
    blockId,
    column,
    layout = 'card',
}: Readonly<PageBlockProps>) {
    const contextValue = useMemo(
        () => ({
            blockId,
            title,
            description,
            column,
        }),
        [blockId, title, description, column],
    );
    return (
        <PageBlockContext.Provider value={contextValue}>
            <LocationWrapper>
                {layout === 'bare' ? (
                    <div className={cn('@container w-full', className)}>
                        {title || description ? (
                            <div className="mb-4 grid gap-1">
                                {title && <div className="text-style-card-title">{title}</div>}
                                {description && (
                                    <div className="text-muted-foreground text-sm">{description}</div>
                                )}
                            </div>
                        ) : null}
                        {children}
                    </div>
                ) : (
                    <Card className={cn('@container  w-full', className)}>
                        {title || description ? (
                            <CardHeader>
                                {title && <CardTitle>{title}</CardTitle>}
                                {description && <CardDescription>{description}</CardDescription>}
                            </CardHeader>
                        ) : null}
                        <CardContent>{children}</CardContent>
                    </Card>
                )}
            </LocationWrapper>
        </PageBlockContext.Provider>
    );
}

// The `control` of any react-hook-form form. Since react-hook-form 7.72.0 a form's `Control<T>`
// is not assignable to `Control<any, any>`. Typing every member as `any` keeps the check that
// the value is a control, and the type is still assignable to `Control<any>` where it is read.
type AnyFormControl = { [K in keyof Control<any, any, any>]: any };

/**
 * @description
 * **Status: Developer Preview**
 *
 * A component for displaying a block of content on a page that takes up the full width of the page.
 * This should be used inside the {@link PageLayout} component.
 *
 * @docsCategory components
 * @docsPage PageBlock
 * @since 3.3.0
 */
export function FullWidthPageBlock({
    children,
    className,
    blockId,
}: Readonly<Pick<PageBlockProps, 'children' | 'className' | 'blockId'>>) {
    const contextValue = useMemo(() => ({ blockId, column: 'full' as const }), [blockId]);
    return (
        <PageBlockContext.Provider value={contextValue}>
            <LocationWrapper>
                <div className={cn('w-full', className)}>{children}</div>
            </LocationWrapper>
        </PageBlockContext.Provider>
    );
}

/**
 * @description *
 * A component for displaying an auto-generated form for custom fields on a page.
 * This is a special form of {@link PageBlock} that automatically generates
 * a form corresponding to the custom fields for the given entity type.
 *
 * @example
 * ```tsx
 * <CustomFieldsPageBlock column="main" entityType="Product" control={form.control} />
 * ```
 *
 * @docsCategory page-layout
 * @docsPage PageBlock
 * @since 3.3.0
 */
export function CustomFieldsPageBlock({
    column,
    entityType,
    control,
}: Readonly<{
    column: 'main' | 'side';
    entityType: string;
    control: AnyFormControl;
}>) {
    const customFieldConfig = useCustomFieldConfig(entityType);
    const isServerConfigLoaded = useIsServerConfigLoaded();

    // Until the server config has resolved we don't know whether this entity
    // has custom fields or not. Render a skeleton placeholder block so the
    // page layout doesn't visibly jump once the config arrives. Once loaded
    // and we're confident there are no custom fields, render nothing.
    if (!isServerConfigLoaded) {
        return (
            <PageBlock column={column} blockId="custom-fields">
                <div className="space-y-4" aria-hidden="true">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-9 w-full" />
                </div>
            </PageBlock>
        );
    }
    if (!customFieldConfig || customFieldConfig.length === 0) {
        return null;
    }
    return (
        <PageBlock column={column} blockId="custom-fields">
            <CustomFieldsForm entityType={entityType} control={control} />
        </PageBlock>
    );
}

/**
 * @description
 * This compares the type of a React component to a given type.
 * It is safer than a simple `el === Component` check, as it also works in the context of
 * the Vite build where the component is not the same reference.
 */
export function isOfType(el: unknown, type: React.FunctionComponent<any>): boolean {
    if (React.isValidElement(el)) {
        const elTypeName = typeof el.type === 'string' ? el.type : (el.type as React.FunctionComponent).name;
        return elTypeName === type.name;
    }
    return false;
}
