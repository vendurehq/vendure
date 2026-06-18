import { PageBlockProps } from '@/vdb/framework/layout-engine/page-layout.js';
import { createContext } from 'react';

export type PageBlockContextValue = Pick<PageBlockProps, 'blockId' | 'column' | 'title' | 'description'>;

export const PageBlockContext = createContext<PageBlockContextValue | undefined>(undefined);
