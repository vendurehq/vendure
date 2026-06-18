import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { NavigationConfirmation } from '@/vdb/components/shared/navigation-confirmation.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/vdb/components/ui/card.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useIsMobile } from '@/vdb/hooks/use-mobile.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useIsServerConfigLoaded } from '@/vdb/hooks/use-server-config.js';
import { cn } from '@/vdb/lib/utils.js';
import { useCopyToClipboard } from '@uidotdev/usehooks';
import { CheckIcon, CopyIcon, EllipsisVerticalIcon, InfoIcon } from 'lucide-react';
import React, { ComponentProps, useMemo, useState } from 'react';
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
import { PageBlockContext } from '@/vdb/framework/layout-engine/page-block-provider.js';
import { PageContext, PageContextValue } from '@/vdb/framework/layout-engine/page-provider.js';
import { Trans } from '@lingui/react/macro';
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
 *        <PageActionBarRight>
 *          <Button>Save</Button>
 *        </PageActionBarRight>
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
        <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 shrink">{pageTitle ?? <div />}</div>
            <div className="shrink-0">{pageActionBar}</div>
        </div>
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
                if (typeof block.shouldRender === 'function' && !block.shouldRender(page)) {
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
                            title={extensionBlock.title}
                        >
                            <extensionBlock.component context={page} />
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
    return (
        <h1 data-testid="page-heading" className="text-2xl font-semibold font-heading">
            {children}
        </h1>
    );
}

type InlineDropdownItem = Omit<DashboardActionBarItem, 'type' | 'pageId'>;

/**
 * @description
 * A component for displaying the main actions for a page. This should be used inside the {@link Page} component.
 *
 * You can add action bar items by including {@link ActionBarItem} components as direct children.
 * For backwards compatibility, {@link PageActionBarLeft} and {@link PageActionBarRight} are also supported.
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
    const childArray = React.Children.toArray(children);

    // Extract different child types
    const leftContent = childArray.filter(child => isOfType(child, PageActionBarLeft));
    const rightContent = childArray.filter(child => isOfType(child, PageActionBarRight));

    // Collect ActionBarItem children (direct or from PageActionBarRight)
    const actionBarItemChildren: React.ReactElement<ActionBarItemProps>[] = [];
    // Collect plain children (not ActionBarItem, not PageActionBarLeft/Right)
    const plainChildren: React.ReactNode[] = [];
    // Collect dropdownMenuItems from PageActionBarRight (backwards compat)
    let legacyDropdownMenuItems: InlineDropdownItem[] = [];

    // Direct children (new pattern)
    childArray.forEach(child => {
        if (isActionBarItem(child)) {
            actionBarItemChildren.push(child);
        } else if (!isOfType(child, PageActionBarLeft) && !isOfType(child, PageActionBarRight)) {
            // Plain children (buttons etc.) that aren't ActionBarItem or layout components
            plainChildren.push(child);
        }
    });

    // Children and dropdownMenuItems from PageActionBarRight (backwards compat)
    rightContent.forEach(rightChild => {
        if (React.isValidElement(rightChild)) {
            const props = rightChild.props as {
                children?: React.ReactNode;
                dropdownMenuItems?: InlineDropdownItem[];
            };
            React.Children.forEach(props.children, child => {
                if (isActionBarItem(child)) {
                    actionBarItemChildren.push(child);
                } else {
                    // Plain children (raw buttons etc.)
                    plainChildren.push(child);
                }
            });
            // Extract dropdownMenuItems from PageActionBarRight props
            if (props.dropdownMenuItems) {
                legacyDropdownMenuItems = [...legacyDropdownMenuItems, ...props.dropdownMenuItems];
            }
        }
    });

    // Separate button items from dropdown items
    const extensionButtonItems = actionBarItems.filter(item => item.type !== 'dropdown');
    const allDropdownMenuItems = [...(dropdownMenuItems ?? []), ...legacyDropdownMenuItems];
    const actionBarDropdownItems = [
        ...allDropdownMenuItems.map(item => ({
            ...item,
            pageId: page.pageId ?? '',
            type: 'dropdown' as const,
        })),
        ...actionBarItems.filter(item => item.type === 'dropdown'),
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

    const renderMergedItem = (mergedItem: MergedActionBarItem, index: number) => {
        if (mergedItem.type === 'inline') {
            return React.cloneElement(mergedItem.element, {
                key: `inline-${mergedItem.element.props.itemId}`,
            });
        } else {
            const extItem = mergedItem.item;
            const itemId = extItem.id ?? `extension-${extItem.component.name || index}`;
            return (
                <ActionBarItemWrapper key={`ext-${extItem.id ?? extItem.pageId}-${index}`} itemId={itemId}>
                    <PageActionBarItem item={extItem} page={page} />
                </ActionBarItemWrapper>
            );
        }
    };

    return (
        <div className={cn('flex gap-2', leftContent.length > 0 ? 'justify-between' : 'justify-end')}>
            {leftContent.length > 0 && <div className="flex justify-start gap-2">{leftContent}</div>}
            {hasRightContent && (
                <div className="flex justify-end gap-2">
                    {/* Plain children only on desktop */}
                    {!isMobile &&
                        plainChildren.map((child, index) => (
                            <React.Fragment key={`plain-${index}`}>{child}</React.Fragment>
                        ))}
                    {/* Merged ActionBarItem children (filtered on mobile) */}
                    {visibleMergedItems.map((mergedItem, index) => renderMergedItem(mergedItem, index))}
                    {actionBarDropdownItems.length > 0 && (
                        <PageActionBarDropdown items={actionBarDropdownItems} page={page} />
                    )}
                    <EntityInfoDropdown entity={page.entity} />
                </div>
            )}
        </div>
    );
}

/**
 * @description
 * The PageActionBarLeft component is not used and will be removed in a future version.
 *
 * @docsCategory page-layout
 * @docsPage PageActionBar
 * @deprecated
 * @since 3.3.0
 */
export function PageActionBarLeft({ children }: Readonly<{ children: React.ReactNode }>) {
    return <div className="flex justify-start gap-2">{children}</div>;
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

function EntityInfoDropdown({ entity }: Readonly<{ entity: any }>) {
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [, copy] = useCopyToClipboard();
    const { formatDate } = useLocalFormat();

    const handleCopy = async (text: string, field: string) => {
        await copy(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    if (!entity?.id) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        data-testid="entity-info-trigger"
                    />
                }
            >
                <InfoIcon className="w-4 h-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>
                        <Trans>Entity Information</Trans>
                    </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <div className="px-3 py-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">ID</span>
                        <div className="flex items-center gap-1">
                            <span className="text-sm font-mono">{entity.id}</span>
                            <button
                                onClick={() => handleCopy(entity.id, 'id')}
                                className="p-1 hover:bg-muted rounded-sm transition-colors"
                            >
                                {copiedField === 'id' ? (
                                    <CheckIcon className="h-3 w-3 text-success" />
                                ) : (
                                    <CopyIcon className="h-3 w-3" />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
                {entity.createdAt && (
                    <>
                        <DropdownMenuSeparator />
                        <div className="px-3 py-2">
                            <div className="text-sm">
                                <div className="font-medium text-muted-foreground">
                                    <Trans>Created</Trans>
                                </div>
                                <div className="text-xs">{formatDate(entity.createdAt)}</div>
                            </div>
                        </div>
                    </>
                )}
                {entity.updatedAt && (
                    <>
                        <DropdownMenuSeparator />
                        <div className="px-3 py-2">
                            <div className="text-sm">
                                <div className="font-medium text-muted-foreground">
                                    <Trans>Updated</Trans>
                                </div>
                                <div className="text-xs">{formatDate(entity.updatedAt)}</div>
                            </div>
                        </div>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * @description
 * The PageActionBarRight component is used to display the right content of the action bar.
 *
 * @deprecated Use {@link ActionBarItem} children directly in {@link PageActionBar} instead.
 *
 * @example
 * ```tsx
 * // Old pattern (deprecated)
 * <PageActionBar>
 *     <PageActionBarRight>
 *         <ActionBarItem itemId="save-button">
 *             <Button type="submit">Update</Button>
 *         </ActionBarItem>
 *     </PageActionBarRight>
 * </PageActionBar>
 *
 * // New pattern (recommended)
 * <PageActionBar>
 *     <ActionBarItem itemId="save-button" requiresPermission={['UpdateProduct']}>
 *         <Button type="submit">Update</Button>
 *     </ActionBarItem>
 * </PageActionBar>
 * ```
 *
 * @docsCategory page-layout
 * @docsPage PageActionBar
 * @since 3.3.0
 */
export function PageActionBarRight({
    children,
    dropdownMenuItems: _dropdownMenuItems,
}: Readonly<{
    /**
     * @description
     * ActionBarItem components that will be rendered in the action bar.
     * Each item should have a unique itemId for extension targeting.
     */
    children?: React.ReactNode;
    /**
     * @description
     * Optional dropdown menu items. These are now extracted and rendered by PageActionBar.
     * @deprecated Pass dropdownMenuItems directly to PageActionBar instead.
     */
    dropdownMenuItems?: InlineDropdownItem[];
}>) {
    // This is now a passthrough wrapper for backwards compatibility.
    // The actual logic is handled by PageActionBar which extracts ActionBarItem
    // children and dropdownMenuItems from PageActionBarRight.
    return <>{children}</>;
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

function PageActionBarDropdown({
    items,
    page,
}: Readonly<{ items: DashboardActionBarItem[]; page: PageContextValue }>) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" data-testid="action-bar-dropdown-trigger" />}
            >
                <EllipsisVerticalIcon className="w-4 h-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {items.map((item, index) => (
                    <PermissionGuard key={item.pageId + index} requires={item.requiresPermission ?? []}>
                        <item.component context={page} />
                    </PermissionGuard>
                ))}
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
                <Card className={cn('@container  w-full', className, 'animate-in fade-in duration-300')}>
                    {title || description ? (
                        <CardHeader>
                            {title && <CardTitle>{title}</CardTitle>}
                            {description && <CardDescription>{description}</CardDescription>}
                        </CardHeader>
                    ) : null}
                    <CardContent>{children}</CardContent>
                </Card>
            </LocationWrapper>
        </PageBlockContext.Provider>
    );
}

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
                <div className={cn('w-full', className, 'animate-in fade-in duration-300')}>{children}</div>
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
    control: Control<any, any>;
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
