import React from 'react';
import { ViewsSheet } from './views-sheet.js';

interface UserViewsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const UserViewsSheet: React.FC<UserViewsSheetProps> = ({ open, onOpenChange }) => {
    return <ViewsSheet open={open} onOpenChange={onOpenChange} type="user" />;
};