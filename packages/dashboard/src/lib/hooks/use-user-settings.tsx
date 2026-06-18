import { UserSettingsContext } from '@/vdb/providers/user-settings.js';
import { useContext } from 'react';

// Hook to use the user settings

export const useUserSettings = () => {
    const context = useContext(UserSettingsContext);
    if (context === undefined) {
        throw new Error('useUserSettings must be used within a UserSettingsProvider');
    }
    return context;
};
