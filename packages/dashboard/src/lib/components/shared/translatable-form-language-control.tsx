import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { CircleAlert } from 'lucide-react';
import { useContext } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs.js';
import { TranslatableFormGroupContext } from './translatable-form-context.js';

const TAB_LANGUAGE_LIMIT = 3;

/**
 * Card-header language control for the nearest translatable form group.
 * Uses tabs when the channel has a few languages, and a compact select when there are many.
 */
export function TranslatableFormLanguageControl() {
    const group = useContext(TranslatableFormGroupContext);
    const { formatLanguageName } = useLocalFormat();
    const { t } = useLingui();

    if (!group || group.languages.length <= 1) {
        return null;
    }

    const { languageCode, languages, languagesWithErrors, setLanguageCode } = group;
    const currentLanguageHasErrors = languagesWithErrors.includes(languageCode);
    const contentLanguageLabel = currentLanguageHasErrors
        ? t`Content language, has validation errors`
        : t`Content language`;

    if (languages.length > TAB_LANGUAGE_LIMIT) {
        const languageItems = Object.fromEntries(
            languages.map(code => [code, `${code.toUpperCase()} — ${formatLanguageName(code)}`]),
        );
        return (
            <Select
                items={languageItems}
                value={languageCode}
                onValueChange={value => value != null && setLanguageCode(String(value))}
            >
                <SelectTrigger
                    size="sm"
                    aria-label={contentLanguageLabel}
                    aria-invalid={currentLanguageHasErrors || undefined}
                    className="w-auto min-w-32"
                >
                    <SelectValue />
                    {currentLanguageHasErrors && (
                        <CircleAlert className="size-3.5 text-destructive" aria-hidden="true" />
                    )}
                </SelectTrigger>
                <SelectContent align="end">
                    {languages.map(code => {
                        const hasErrors = languagesWithErrors.includes(code);
                        return (
                            <SelectItem key={code} value={code}>
                                {languageItems[code]}
                                {hasErrors && (
                                    <>
                                        <CircleAlert
                                            className="ms-auto size-4 text-destructive"
                                            aria-hidden="true"
                                        />
                                        <span className="sr-only">
                                            <Trans>Has validation errors</Trans>
                                        </span>
                                    </>
                                )}
                            </SelectItem>
                        );
                    })}
                </SelectContent>
            </Select>
        );
    }

    return (
        <Tabs value={languageCode} onValueChange={value => value != null && setLanguageCode(String(value))}>
            <TabsList aria-label={contentLanguageLabel} className="h-7">
                {languages.map(code => {
                    const hasErrors = languagesWithErrors.includes(code);
                    const languageName = formatLanguageName(code);
                    return (
                        <TabsTrigger
                            key={code}
                            value={code}
                            aria-label={hasErrors ? t`${languageName}, has validation errors` : languageName}
                            title={languageName}
                            data-invalid={hasErrors || undefined}
                        >
                            {code.toUpperCase()}
                            {hasErrors && (
                                <CircleAlert className="size-3.5 text-destructive" aria-hidden="true" />
                            )}
                        </TabsTrigger>
                    );
                })}
            </TabsList>
        </Tabs>
    );
}
