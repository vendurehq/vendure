import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { FormProvider, Resolver, useForm, useFormContext } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Input } from '@/vdb/components/ui/input.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { useTranslatableForm } from '@/vdb/hooks/use-translatable-form.js';
import {
    ChannelContext,
    type ChannelContext as ChannelContextValue,
} from '@/vdb/providers/channel-provider.js';
import { UserSettingsContext, type UserSettingsContextType } from '@/vdb/providers/user-settings.js';

import { PageBlock } from '@/vdb/framework/layout-engine/page-layout.js';

import { TranslatableFormFieldWrapper, TranslatableFormGroup } from './translatable-form-field.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function TestProviders({
    children,
    languages = ['en', 'de'],
    contentLanguage = 'en',
    setContentLanguage = vi.fn(),
    resolver,
}: Readonly<{
    children: React.ReactNode;
    languages?: string[];
    contentLanguage?: string;
    setContentLanguage?: (language: string) => void;
    resolver?: Resolver<any>;
}>) {
    const form = useForm({
        defaultValues: {
            translations: [
                {
                    id: 'translation-en',
                    languageCode: 'en',
                    name: 'English name',
                    slug: 'english-name',
                },
                {
                    id: 'translation-de',
                    languageCode: 'de',
                    name: 'Deutscher Name',
                    slug: 'deutscher-name',
                },
            ],
        },
        resolver,
    });
    const userSettings = {
        settings: {
            displayLanguage: 'en',
            contentLanguage,
            theme: 'system',
            displayUiExtensionPoints: false,
            mainNavExpanded: true,
            activeChannelId: 'channel-1',
            devMode: false,
            hasSeenOnboarding: false,
            tableSettings: {},
        },
        setContentLanguage,
    } as UserSettingsContextType;
    const channel = {
        isLoading: false,
        channels: [],
        activeChannel: {
            id: 'channel-1',
            code: 'default-channel',
            token: 'default-channel',
            defaultLanguageCode: 'en',
            defaultCurrencyCode: 'USD',
            pricesIncludeTax: false,
            availableLanguageCodes: languages,
            availableCurrencyCodes: ['USD'],
        },
        setActiveChannel: vi.fn(),
        refreshChannels: vi.fn(),
    } as unknown as ChannelContextValue;

    return (
        <I18nProvider i18n={i18n}>
            <UserSettingsContext.Provider value={userSettings}>
                <ChannelContext.Provider value={channel}>
                    <PageContext.Provider value={{ pageId: 'translation-test', form }}>
                        <FormProvider {...form}>{children}</FormProvider>
                    </PageContext.Provider>
                </ChannelContext.Provider>
            </UserSettingsContext.Provider>
        </I18nProvider>
    );
}

function SubmitButton() {
    const form = useFormContext();
    return (
        <button type="button" onClick={() => void form.handleSubmit(() => undefined)()}>
            Submit
        </button>
    );
}

function NameGroup() {
    return (
        <TranslatableFormGroup>
            <TranslatableFormFieldWrapper
                name="name"
                label="Name"
                render={({ field }) => <Input {...field} />}
            />
        </TranslatableFormGroup>
    );
}

function NameAndSlugGroup() {
    return (
        <TranslatableFormGroup>
            <TranslatableFormFieldWrapper
                name="name"
                label="Name"
                render={({ field }) => <Input {...field} />}
            />
            <TranslatableFormFieldWrapper
                name="slug"
                label="Slug"
                render={({ field }) => <Input {...field} />}
            />
        </TranslatableFormGroup>
    );
}

function getLanguageTabs() {
    return Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
}

function getSelectedLanguageCode() {
    const selectedTab = getLanguageTabs().find(
        tab => tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('data-state') === 'active',
    );
    if (selectedTab) {
        return selectedTab.textContent?.replace(/[^A-Z]/g, '');
    }
    return container.querySelector('[data-slot="select-value"]')?.textContent;
}

async function selectLanguageTab(languageCode: string) {
    const tab = getLanguageTabs().find(item => item.textContent?.includes(languageCode));
    expect(tab).toBeDefined();
    await act(async () => {
        tab?.click();
        await Promise.resolve();
    });
}

async function selectLanguageOption(languageName: string) {
    const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
    await act(async () => {
        trigger.click();
        await Promise.resolve();
    });
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(item =>
        item.textContent?.includes(languageName),
    ) as HTMLElement | undefined;
    expect(option).toBeDefined();
    await act(async () => {
        option?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        await Promise.resolve();
    });
    await act(async () => {
        option?.click();
        await Promise.resolve();
    });
}

function SetGermanNameErrorButton() {
    const { setError } = useFormContext();
    return (
        <button
            type="button"
            onClick={() => setError('translations.1.name', { type: 'manual', message: 'Required' })}
        >
            Set German error
        </button>
    );
}

function TranslatableFormStateProbe() {
    const translatableForm = useTranslatableForm();
    return (
        <div>
            <span data-testid="selected-form-language">
                {translatableForm?.languageCode ?? 'no-local-language'}
            </span>
            <button type="button" onClick={() => translatableForm?.setLanguageCode('de')}>
                Select German programmatically
            </button>
            <button type="button" onClick={() => translatableForm?.setLanguageCode('fr')}>
                Select unavailable language
            </button>
        </div>
    );
}

describe('TranslatableFormGroup', () => {
    it('hides the language control for one language and shows tabs for a few languages', () => {
        act(() => {
            root.render(
                <TestProviders languages={['en']}>
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(container.querySelector('[role="tablist"]')).toBeNull();
        expect(container.querySelector('[role="combobox"]')).toBeNull();

        act(() => {
            root.render(
                <TestProviders languages={['en', 'de', 'fr']}>
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(getLanguageTabs().map(tab => tab.textContent)).toEqual(['EN', 'DE', 'FR']);
        expect(getSelectedLanguageCode()).toBe('EN');
        expect(container.querySelector('[role="combobox"]')).toBeNull();
    });

    it('places the language tabs in the PageBlock card header', () => {
        act(() => {
            root.render(
                <TestProviders>
                    <TranslatableFormGroup>
                        <PageBlock column="main" blockId="main-form">
                            <TranslatableFormFieldWrapper
                                name="name"
                                label="Name"
                                render={({ field }) => <Input {...field} />}
                            />
                        </PageBlock>
                    </TranslatableFormGroup>
                </TestProviders>,
            );
        });

        const header = container.querySelector('[data-slot="card-header"]');
        expect(header?.querySelector('[role="tablist"]')).not.toBeNull();
        expect(container.querySelector('[data-slot="field"] [role="tablist"]')).toBeNull();
        expect(container.querySelector('[data-slot="field"] [role="combobox"]')).toBeNull();
    });

    it('switches every localized field without changing the global content language', async () => {
        const setContentLanguage = vi.fn();
        act(() => {
            root.render(
                <TestProviders setContentLanguage={setContentLanguage}>
                    <NameAndSlugGroup />
                </TestProviders>,
            );
        });

        const inputs = Array.from(container.querySelectorAll('input[id^="field-"]')) as HTMLInputElement[];
        expect(inputs.map(input => input.value)).toEqual(['English name', 'english-name']);
        expect(getLanguageTabs()).toHaveLength(2);

        await selectLanguageTab('DE');

        const germanInputs = Array.from(
            container.querySelectorAll('input[id^="field-"]'),
        ) as HTMLInputElement[];
        expect(germanInputs.map(input => input.value)).toEqual(['Deutscher Name', 'deutscher-name']);
        expect(germanInputs[0].placeholder).toBe('Fallback: English name');
        expect(getSelectedLanguageCode()).toBe('DE');
        expect(setContentLanguage).not.toHaveBeenCalled();
    });

    it('keeps separate groups on independently selected languages', async () => {
        act(() => {
            root.render(
                <TestProviders>
                    <NameGroup />
                    <NameGroup />
                </TestProviders>,
            );
        });

        const firstTablist = container.querySelectorAll('[role="tablist"]')[0];
        const firstGermanTab = Array.from(firstTablist.querySelectorAll('[role="tab"]')).find(tab =>
            tab.textContent?.includes('DE'),
        ) as HTMLElement;
        await act(async () => {
            firstGermanTab.click();
            await Promise.resolve();
        });

        const inputs = Array.from(container.querySelectorAll('input[id^="field-"]')) as HTMLInputElement[];
        expect(inputs.map(input => input.value)).toEqual(['Deutscher Name', 'English name']);
        const selectedCodes = Array.from(container.querySelectorAll('[role="tablist"]')).map(list =>
            Array.from(list.querySelectorAll('[role="tab"]'))
                .find(
                    tab =>
                        tab.getAttribute('aria-selected') === 'true' ||
                        tab.getAttribute('data-state') === 'active',
                )
                ?.textContent?.replace(/[^A-Z]/g, ''),
        );
        expect(selectedCodes).toEqual(['DE', 'EN']);
    });

    it('exposes the selected language to custom form elements', () => {
        act(() => {
            root.render(
                <TestProviders>
                    <TranslatableFormGroup>
                        <TranslatableFormFieldWrapper
                            name="name"
                            label="Name"
                            render={({ field }) => <Input {...field} />}
                        />
                        <TranslatableFormStateProbe />
                    </TranslatableFormGroup>
                </TestProviders>,
            );
        });

        const language = container.querySelector('[data-testid="selected-form-language"]');
        expect(language?.textContent).toBe('en');

        const selectGermanButton = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent === 'Select German programmatically',
        ) as HTMLButtonElement;
        act(() => selectGermanButton.click());

        expect(language?.textContent).toBe('de');
        expect((container.querySelector('input[id^="field-"]') as HTMLInputElement).value).toBe(
            'Deutscher Name',
        );

        const selectUnavailableButton = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent === 'Select unavailable language',
        ) as HTMLButtonElement;
        act(() => selectUnavailableButton.click());

        expect(language?.textContent).toBe('de');
    });

    it('returns undefined outside a translatable form group', () => {
        act(() => {
            root.render(
                <TestProviders>
                    <TranslatableFormStateProbe />
                </TestProviders>,
            );
        });

        expect(container.querySelector('[data-testid="selected-form-language"]')?.textContent).toBe(
            'no-local-language',
        );
    });

    it('falls back to the channel default when the global language is unavailable', () => {
        act(() => {
            root.render(
                <TestProviders contentLanguage="fr">
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(getSelectedLanguageCode()).toBe('EN');
        expect((container.querySelector('input[id^="field-"]') as HTMLInputElement).value).toBe(
            'English name',
        );
    });

    it('initializes from the global language when it is available in the channel', () => {
        act(() => {
            root.render(
                <TestProviders contentLanguage="de">
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(getSelectedLanguageCode()).toBe('DE');
        expect((container.querySelector('input[id^="field-"]') as HTMLInputElement).value).toBe(
            'Deutscher Name',
        );
    });

    it('exposes language tabs to the keyboard', () => {
        act(() => {
            root.render(
                <TestProviders>
                    <NameGroup />
                </TestProviders>,
            );
        });

        const tabs = getLanguageTabs();
        expect(tabs.length).toBeGreaterThan(1);
        expect(tabs.some(tab => tab.tabIndex >= 0)).toBe(true);
        expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toMatch(
            /Content language/,
        );
    });

    it('lists every available language in the dropdown when there are many languages', async () => {
        act(() => {
            root.render(
                <TestProviders languages={['en', 'de', 'fr', 'es']}>
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(container.querySelector('[role="tablist"]')).toBeNull();
        await selectLanguageOption('Spanish');
        expect(getSelectedLanguageCode()).toMatch(/ES/);
    });

    it('marks only the language containing an error on its tab', async () => {
        act(() => {
            root.render(
                <TestProviders>
                    <NameGroup />
                    <SetGermanNameErrorButton />
                </TestProviders>,
            );
        });

        const errorButton = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent === 'Set German error',
        ) as HTMLButtonElement;
        act(() => errorButton.click());

        const germanTab = getLanguageTabs().find(tab => tab.textContent?.includes('DE')) as HTMLElement;
        expect(germanTab.getAttribute('data-invalid')).toBe('true');
        expect(germanTab.querySelector('svg')).not.toBeNull();
        expect(getLanguageTabs()[0].getAttribute('data-invalid')).toBeNull();
    });

    it('opens the first language with a group error after an invalid submit', async () => {
        const resolver: Resolver<any> = async () => ({
            values: {},
            errors: {
                translations: [
                    {},
                    {
                        name: { type: 'required', message: 'Required' },
                    },
                ],
            },
        });
        await act(async () => {
            root.render(
                <TestProviders resolver={resolver}>
                    <NameGroup />
                    <SubmitButton />
                </TestProviders>,
            );
        });

        await act(async () => {
            const submitButton = Array.from(container.querySelectorAll('button')).find(
                button => button.textContent === 'Submit',
            ) as HTMLButtonElement;
            submitButton.click();
        });

        expect(getSelectedLanguageCode()).toBe('DE');
        expect((container.querySelector('input[id^="field-"]') as HTMLInputElement).value).toBe(
            'Deutscher Name',
        );
    });
});
