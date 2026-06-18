import * as React from 'react';

export type SidebarContext = {
    state: 'expanded' | 'collapsed';
    open: boolean;
    setOpen: (open: boolean) => void;
    openMobile: boolean;
    setOpenMobile: (open: boolean) => void;
    isMobile: boolean;
    toggleSidebar: () => void;
};

// This is split into a separate file from `sidebar.tsx` because having them in the same
// file causes the app to break on HMR in dev mode. It relates to this issue:
// https://github.com/vitejs/vite/issues/3301#issuecomment-1080030773
export const SidebarContext = React.createContext<SidebarContext | null>(null);
