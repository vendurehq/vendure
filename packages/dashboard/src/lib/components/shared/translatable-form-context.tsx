import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import React from 'react';

export interface RegisteredTranslatableField {
    name: string;
    blockId?: string;
}

export interface TranslatableFormGroupContextValue {
    languageCode: string;
    languages: string[];
    languagesWithErrors: string[];
    setLanguageCode: (languageCode: string) => void;
    registerField: (fieldName: string, blockId?: string) => () => void;
    hasFieldsInBlock: (blockId?: string) => boolean;
}

export const TranslatableFormGroupContext = React.createContext<
    TranslatableFormGroupContextValue | undefined
>(undefined);

export function useResolvedContentLanguage() {
    const group = React.useContext(TranslatableFormGroupContext);
    const { contentLanguage } = useUserSettings().settings;
    return group?.languageCode ?? contentLanguage;
}
