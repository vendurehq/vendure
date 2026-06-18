import { getAppConfig } from '../../app.config';
import { GetNetworkStatusQuery, GetUiStateQuery, GetUserStatusQuery } from '../../common/generated-types';
import { getDefaultUiLanguage, getDefaultUiLocale } from '../../common/utilities/get-default-ui-language';
import { LocalStorageService } from '../../providers/local-storage/local-storage.service';

export function getClientDefaults(localStorageService: LocalStorageService) {
    const currentLanguage = localStorageService.get('uiLanguageCode') || getDefaultUiLanguage();
    const currentLocale = localStorageService.get('uiLocale') || getDefaultUiLocale();
    const currentContentLanguage = localStorageService.get('contentLanguageCode') || getDefaultUiLanguage();
    const activeTheme = localStorageService.get('activeTheme') || 'default';
    return {
        networkStatus: {
            inFlightRequests: 0,
            __typename: 'NetworkStatus',
        } as GetNetworkStatusQuery['networkStatus'],
        userStatus: {
            administratorId: null,
            username: '',
            isLoggedIn: false,
            loginTime: '',
            activeChannelId: null,
            permissions: [],
            channels: [],
            __typename: 'UserStatus',
        } as GetUserStatusQuery['userStatus'],
        uiState: {
            language: currentLanguage,
            locale: currentLocale || '',
            contentLanguage: currentContentLanguage,
            theme: activeTheme,
            displayUiExtensionPoints: false,
            mainNavExpanded: false,
            __typename: 'UiState',
        } as GetUiStateQuery['uiState'],
    };
}
