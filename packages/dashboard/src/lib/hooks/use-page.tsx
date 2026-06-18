import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { useContext } from 'react';

export function usePage() {
    const page = useContext(PageContext);
    if (!page) {
        throw new Error('PageProvider not found');
    }
    return page;
}
