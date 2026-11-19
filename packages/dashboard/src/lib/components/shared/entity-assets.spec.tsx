import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityAssets } from './entity-assets.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

function renderAssets(onChange: () => void) {
    act(() =>
        root.render(
            <I18nProvider i18n={i18n}>
                <EntityAssets assets={[]} onChange={onChange} />
            </I18nProvider>,
        ),
    );
}

const addAssetButton = () =>
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add asset');

afterEach(() => act(() => root.render(null)));

describe('EntityAssets', () => {
    // The asset picker returns focus to the element that opened it. A remounted button is a new
    // element, so focus would drop to the page when the picker closes (OSS-1397).
    it('keeps the same Add asset button across renders', () => {
        renderAssets(() => undefined);
        const before = addAssetButton();
        expect(before).toBeDefined();

        renderAssets(() => undefined);

        expect(addAssetButton()).toBe(before);
    });
});
