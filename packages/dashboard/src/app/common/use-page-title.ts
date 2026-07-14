import { useMatches } from '@tanstack/react-router';
import React, { isValidElement, ReactElement, useEffect, useState } from 'react';

const DEFAULT_TITLE = 'Vendure';

/**
 * @description
 * Derives the meta title of the page based on the current route's breadcrumb
 * data from the route loader.
 */
export function usePageTitle() {
    const matches = useMatches();
    const [pageTitle, setPageTitle] = useState<string>(DEFAULT_TITLE);

    useEffect(() => {
        const lastMatch = matches.at(-1);
        const breadcrumb = (lastMatch?.loaderData as any)?.breadcrumb;

        const breadcrumbTitle = normalizeBreadcrumb(breadcrumb);
        setPageTitle([breadcrumbTitle, DEFAULT_TITLE].filter(x => !!x).join(' • '));
    }, [matches]);

    return pageTitle;
}

const renderNodeAsString = function (reactNode: React.ReactNode): string {
    let string = '';
    if (typeof reactNode === 'string') {
        string = reactNode;
    } else if (typeof reactNode === 'number') {
        string = reactNode.toString();
    } else if (Array.isArray(reactNode)) {
        reactNode.forEach(function (child) {
            string += renderNodeAsString(child);
        });
    } else if (isValidElement(reactNode)) {
        const props = (reactNode as ReactElement<any>).props;
        if (props.children != null) {
            string += renderNodeAsString(props.children);
        } else if (typeof props.message === 'string') {
            // Lingui's babel macro compiles <Trans>Text</Trans> into
            // <Trans id="hash" message="Text" />, stripping children.
            string += props.message;
        }
    }
    return string;
};

/**
 * Recursively normalizes a breadcrumb value to a string.
 * Handles functions, arrays, objects with labels, and React nodes.
 */
export const normalizeBreadcrumb = (value: any, visited = new WeakSet()): string => {
    // Handle null/undefined
    if (value == null) {
        return '';
    }

    // If it's a function, call it and normalize the result
    if (typeof value === 'function') {
        return normalizeBreadcrumb(value(), visited);
    }

    // If it's already a string, return it
    if (typeof value === 'string') {
        return value;
    }

    // If it's an array, normalize the last element
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '';
        }
        return normalizeBreadcrumb(value.at(-1), visited);
    }

    // For objects, check for circular references
    if (typeof value === 'object') {
        // Prevent circular reference infinite loops
        if (visited.has(value)) {
            return '';
        }
        visited.add(value);

        // If it's an object with a label property, normalize the label
        if ('label' in value) {
            return normalizeBreadcrumb(value.label, visited);
        }
    }

    // For everything else (React nodes, numbers, etc.), use renderNodeAsString
    return renderNodeAsString(value);
};
