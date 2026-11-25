import {
    Breadcrumb,
    BreadcrumbEllipsis,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/vdb/components/ui/breadcrumb.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import type { NavMenuItem, NavMenuSection } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { getNavMenuConfig } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { cn } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { Link, useRouterState } from '@tanstack/react-router';
import * as React from 'react';
import { Fragment } from 'react';

export interface BreadcrumbPair {
    label: string | React.ReactElement;
    path: string;
}

export type BreadcrumbShorthand = string | React.ReactElement;

export type PageBreadcrumb = BreadcrumbPair | BreadcrumbShorthand;

type SectionCrumb = BreadcrumbPair & { repeatsItem?: boolean; item?: BreadcrumbPair };

const isBaseRoute = (p: string) => p === '' || p === `/`;

const stripTrailingSlash = (p: string) => (p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p);

/**
 * The crumb of a page whose loader has not finished, e.g. the entity name of a
 * detail page.
 */
function LoadingCrumb() {
    return (
        <>
            <Skeleton className="inline-block h-4 w-24 align-middle" aria-hidden="true" />
            <span className="sr-only">
                <Trans>Loading…</Trans>
            </span>
        </>
    );
}

export function GeneratedBreadcrumbs() {
    const matches = useRouterState({ select: s => s.matches });
    const currentPath = useRouterState({ select: s => s.location.pathname });
    // The crumbs come from the loader of the page. Until the page of the location
    // has loaded, the matches are those of the previous page or have no loader data.
    const pageLoaded = useRouterState({
        select: s => {
            const page = s.matches.at(-1);
            return (
                !!page &&
                stripTrailingSlash(page.pathname) === stripTrailingSlash(s.location.pathname) &&
                (page.status !== 'pending' || page.loaderData !== undefined)
            );
        },
    });
    const { i18n } = useLingui();
    const navMenuConfig = getNavMenuConfig();

    const normalizeBreadcrumb = (breadcrumb: any, pathname: string): BreadcrumbPair[] => {
        if (typeof breadcrumb === 'string') {
            return [{ label: breadcrumb, path: pathname }];
        }
        if (React.isValidElement(breadcrumb)) {
            return [{ label: breadcrumb, path: pathname }];
        }
        if (typeof breadcrumb === 'function') {
            return [{ label: breadcrumb(), path: pathname }];
        }
        if (Array.isArray(breadcrumb)) {
            return breadcrumb.map((crumb: PageBreadcrumb) => {
                if (typeof crumb === 'string' || React.isValidElement(crumb)) {
                    return { label: crumb, path: pathname };
                }
                return { label: crumb.label, path: crumb.path };
            });
        }
        return [];
    };

    const rawCrumbs: BreadcrumbPair[] = React.useMemo(() => {
        return matches
            .filter(match => match.loaderData?.breadcrumb)
            .flatMap(({ pathname, loaderData }) => normalizeBreadcrumb(loaderData.breadcrumb, pathname));
    }, [matches]);

    const pageCrumbs: BreadcrumbPair[] = React.useMemo(
        () => rawCrumbs.filter(c => !isBaseRoute(c.path)),
        [rawCrumbs],
    );

    const normalizePath = (path: string): string => {
        return path.startsWith('/') ? path : `/${path}`;
    };

    const pathMatches = (cleanPath: string, rawUrl?: string): boolean => {
        if (!rawUrl) return false;
        const p = stripTrailingSlash(cleanPath);
        const u = stripTrailingSlash(rawUrl);
        return p === u || p.startsWith(`${u}/`);
    };

    // Nav-menu section titles are static translation keys (same convention as
    // nav-main.tsx); page-level breadcrumbs from loaders may be dynamic entity
    // names (product/collection/facet names) and must NOT be passed through
    // i18n.t() — the BreadcrumbLink render below renders `label` as-is.
    const translateSectionTitle = (title: string) => (title in i18n.messages ? i18n.t(title) : title);

    const checkSectionItems = (
        section: NavMenuSection | NavMenuItem,
        cleanPath: string,
    ): SectionCrumb | undefined => {
        if (!('items' in section) || !Array.isArray(section.items)) {
            return undefined;
        }

        for (const item of section.items) {
            if (!item?.url) continue;
            if (pathMatches(cleanPath, item.url)) {
                return {
                    label: translateSectionTitle(section.title),
                    path: item.url,
                    // A section named like its matched item ("Customers" > "Customers")
                    // would repeat the page's own crumb for the same path.
                    repeatsItem: section.title === item.title,
                    item: { label: translateSectionTitle(item.title), path: item.url },
                };
            }
        }
        return undefined;
    };

    const checkDirectSection = (
        section: NavMenuSection | NavMenuItem,
        cleanPath: string,
    ): BreadcrumbPair | undefined => {
        if ('url' in section && section.url && pathMatches(cleanPath, section.url)) {
            return { label: translateSectionTitle(section.title), path: section.url };
        }
        return undefined;
    };

    const findSectionCrumb = (path: string): SectionCrumb | undefined => {
        const cleanPath = normalizePath(path);
        const sections: Array<NavMenuSection | NavMenuItem> = navMenuConfig?.sections ?? [];
        if (sections.length === 0) return undefined;

        for (const section of sections) {
            const result = checkSectionItems(section, cleanPath) || checkDirectSection(section, cleanPath);
            if (result) {
                return result;
            }
        }
        return undefined;
    };

    const sectionCrumb = React.useMemo(() => findSectionCrumb(currentPath), [currentPath, navMenuConfig]);
    const breadcrumbs: BreadcrumbPair[] = React.useMemo(() => {
        if (!pageLoaded) {
            // The crumbs of the nav menu item at once, and a placeholder for the
            // crumb that the loader of a page below that item adds.
            const crumbs: BreadcrumbPair[] = [];
            if (sectionCrumb && !(sectionCrumb.repeatsItem && sectionCrumb.item)) {
                crumbs.push({ label: sectionCrumb.label, path: sectionCrumb.path });
            }
            if (sectionCrumb?.item) {
                crumbs.push(sectionCrumb.item);
            }
            const menuPath = sectionCrumb?.item?.path ?? sectionCrumb?.path;
            if (
                !menuPath ||
                stripTrailingSlash(menuPath) !== stripTrailingSlash(normalizePath(currentPath))
            ) {
                crumbs.push({ label: <LoadingCrumb />, path: currentPath });
            }
            return crumbs;
        }
        const repeatsPageCrumb =
            sectionCrumb?.repeatsItem && pageCrumbs.some(crumb => crumb.path === sectionCrumb.path);
        const arr = sectionCrumb && !repeatsPageCrumb ? [sectionCrumb, ...pageCrumbs] : pageCrumbs;
        return arr.filter(
            (c, i, self) => self.findIndex(x => x.path === c.path && x.label === c.label) === i,
        );
    }, [pageLoaded, sectionCrumb, pageCrumbs, currentPath]);
    const last = breadcrumbs.length - 1;
    // Below 768px only the parent and the current page fit next to the sidebar
    // toggle. The crumbs before them collapse into the ellipsis.
    const collapsesBelowMd = (index: number) => index < last - 1;
    return (
        <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
                {last > 1 && (
                    <>
                        <BreadcrumbItem className="md:hidden">
                            <BreadcrumbEllipsis />
                        </BreadcrumbItem>
                        <BreadcrumbSeparator className="md:hidden" />
                    </>
                )}
                {breadcrumbs.map(({ label, path }, index) => (
                    <Fragment key={`${path}-${index}`}>
                        <BreadcrumbItem
                            className={cn(
                                index === last ? 'min-w-0' : 'shrink-0',
                                collapsesBelowMd(index) && 'max-md:hidden',
                            )}
                        >
                            {index === last ? (
                                <BreadcrumbPage className="truncate">{label}</BreadcrumbPage>
                            ) : (
                                <BreadcrumbLink render={<Link to={path} />}>{label}</BreadcrumbLink>
                            )}
                        </BreadcrumbItem>
                        {index < last && (
                            <BreadcrumbSeparator className={cn(collapsesBelowMd(index) && 'max-md:hidden')} />
                        )}
                    </Fragment>
                ))}
            </BreadcrumbList>
        </Breadcrumb>
    );
}
