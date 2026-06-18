import { createContext } from 'react';
import { UseFormReturn } from 'react-hook-form';

export interface PageContextValue {
    pageId?: string;
    entity?: any;
    form?: UseFormReturn<any>;
}

export const PageContext = createContext<PageContextValue | undefined>(undefined);
