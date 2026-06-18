import { ReactDataTableComponentProps } from '@vendure/admin-ui/react';
import React from 'react';

export function SlugWithLink({ rowItem }: ReactDataTableComponentProps<{ slug: string }>) {
    const slug = rowItem.slug;
    return (
        <a href={`https://example.com/category/${slug}`} target="_blank">
            {slug}
        </a>
    );
}
