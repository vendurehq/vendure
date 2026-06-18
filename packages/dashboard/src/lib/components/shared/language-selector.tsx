import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useSortedLanguages } from '@/vdb/hooks/use-sorted-languages.js';
import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { MultiSelect } from './multi-select.js';

const availableGlobalLanguages = graphql(`
    query AvailableGlobalLanguages {
        globalSettings {
            availableLanguages
        }
    }
`);

export interface LanguageSelectorProps<T extends boolean> {
    value: T extends true ? string[] : string;
    onChange: (value: T extends true ? string[] : string) => void;
    multiple?: T;
    availableLanguageCodes?: string[];
}

export function LanguageSelector<T extends boolean>(props: LanguageSelectorProps<T>) {
    const { data } = useQuery({
        queryKey: ['availableGlobalLanguages'],
        queryFn: () => api.query(availableGlobalLanguages),
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
    const { value, onChange, multiple, availableLanguageCodes } = props;
    const { t } = useLingui();

    const sortedLanguages = useSortedLanguages(
        availableLanguageCodes ?? data?.globalSettings.availableLanguages ?? undefined,
    );

    const items = useMemo(
        () =>
            sortedLanguages.map(language => ({
                value: language.code,
                label: language.label,
            })),
        [sortedLanguages],
    );

    return (
        <MultiSelect
            value={value}
            onChange={onChange}
            multiple={multiple}
            items={items}
            placeholder={t`Select a language`}
            searchPlaceholder={t`Search languages...`}
        />
    );
}
