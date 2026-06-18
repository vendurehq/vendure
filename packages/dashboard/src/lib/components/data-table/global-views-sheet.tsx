import React from 'react';
import { ViewsSheet } from './views-sheet.js';

interface GlobalViewsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const GlobalViewsSheet: React.FC<GlobalViewsSheetProps> = ({ open, onOpenChange }) => {
    return <ViewsSheet open={open} onOpenChange={onOpenChange} type="global" />;
};