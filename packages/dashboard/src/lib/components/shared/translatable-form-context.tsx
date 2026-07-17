import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import React from 'react';

export interface TranslatableFormGroupContextValue {
    languageCode: string;
    languages: string[];
    languagesWithErrors: string[];
    setLanguageCode: (languageCode: string) => void;
    registerField: (fieldName: string) => () => void;
}

export const TranslatableFormGroupContext = React.createContext<
    TranslatableFormGroupContextValue | undefined
>(undefined);

export function useResolvedContentLanguage() {
    const group = React.useContext(TranslatableFormGroupContext);
    const { contentLanguage } = useUserSettings().settings;
    return group?.languageCode ?? contentLanguage;
}
