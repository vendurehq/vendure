import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { FormProvider, Resolver, useForm, useFormContext } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Input } from '@/vdb/components/ui/input.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import {
    ChannelContext,
    type ChannelContext as ChannelContextValue,
} from '@/vdb/providers/channel-provider.js';
import { UserSettingsContext, type UserSettingsContextType } from '@/vdb/providers/user-settings.js';

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

async function selectLanguage(trigger: HTMLElement, languageName: string) {
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

function getTriggerCode(trigger: Element | null) {
    return trigger?.querySelector('[data-slot="select-value"]')?.textContent;
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

describe('TranslatableFormGroup', () => {
    it('renders a static code for one language and an inline dropdown for multiple languages', () => {
        act(() => {
            root.render(
                <TestProviders languages={['en']}>
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(container.querySelector('[role="combobox"]')).toBeNull();
        expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('EN');

        act(() => {
            root.render(
                <TestProviders languages={['en', 'de', 'fr']}>
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
        expect(getTriggerCode(container.querySelector('[role="combobox"]'))).toBe('EN');
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
        const triggers = Array.from(container.querySelectorAll('[role="combobox"]')) as HTMLElement[];
        expect(triggers).toHaveLength(2);

        await selectLanguage(triggers[0], 'DEGerman');

        const germanInputs = Array.from(
            container.querySelectorAll('input[id^="field-"]'),
        ) as HTMLInputElement[];
        expect(germanInputs.map(input => input.value)).toEqual(['Deutscher Name', 'deutscher-name']);
        expect(germanInputs[0].placeholder).toBe('Fallback: English name');
        expect(Array.from(container.querySelectorAll('[role="combobox"]')).map(getTriggerCode)).toEqual([
            'DE',
            'DE',
        ]);
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

        const triggers = Array.from(container.querySelectorAll('[role="combobox"]')) as HTMLElement[];
        await selectLanguage(triggers[0], 'DEGerman');

        const inputs = Array.from(container.querySelectorAll('input[id^="field-"]')) as HTMLInputElement[];
        expect(inputs.map(input => input.value)).toEqual(['Deutscher Name', 'English name']);
        expect(Array.from(container.querySelectorAll('[role="combobox"]')).map(getTriggerCode)).toEqual([
            'DE',
            'EN',
        ]);
    });

    it('falls back to the channel default when the global language is unavailable', () => {
        act(() => {
            root.render(
                <TestProviders contentLanguage="fr">
                    <NameGroup />
                </TestProviders>,
            );
        });

        expect(getTriggerCode(container.querySelector('[role="combobox"]'))).toBe('EN');
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

        expect(getTriggerCode(container.querySelector('[role="combobox"]'))).toBe('DE');
        expect((container.querySelector('input[id^="field-"]') as HTMLInputElement).value).toBe(
            'Deutscher Name',
        );
    });

    it('opens the language dropdown from the keyboard', async () => {
        act(() => {
            root.render(
                <TestProviders>
                    <NameGroup />
                </TestProviders>,
            );
        });

        const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
        await act(async () => {
            trigger.focus();
            trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            await Promise.resolve();
        });

        expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(2);
    });

    it('lists every available language in the dropdown', async () => {
        act(() => {
            root.render(
                <TestProviders languages={['en', 'de', 'fr', 'es']}>
                    <NameGroup />
                </TestProviders>,
            );
        });

        const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
        await act(async () => {
            trigger.click();
            await Promise.resolve();
        });

        expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(4);
        expect(document.body.textContent).toContain('ESSpanish');
    });

    it('marks only the language containing an error in the dropdown', async () => {
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

        const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
        expect(trigger.getAttribute('aria-label')).toBe('English');
        await act(async () => {
            trigger.click();
            await Promise.resolve();
        });
        const germanOption = Array.from(document.body.querySelectorAll('[role="option"]')).find(item =>
            item.textContent?.includes('DEGerman'),
        ) as HTMLElement;
        expect(germanOption.textContent).toContain('Has validation errors');
        expect(germanOption.querySelector('svg')).not.toBeNull();
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

        expect(getTriggerCode(container.querySelector('[role="combobox"]'))).toBe('DE');
        expect((container.querySelector('input[id^="field-"]') as HTMLInputElement).value).toBe(
            'Deutscher Name',
        );
    });
});
