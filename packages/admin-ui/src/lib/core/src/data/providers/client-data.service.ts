import * as Codegen from '../../common/generated-types';
import { CurrentUserChannel, LanguageCode, SetMainNavExpandedDocument } from '../../common/generated-types';
import {
    GET_NEWTORK_STATUS,
    GET_UI_STATE,
    GET_USER_STATUS,
    REQUEST_COMPLETED,
    REQUEST_STARTED,
    SET_ACTIVE_CHANNEL,
    SET_AS_LOGGED_IN,
    SET_AS_LOGGED_OUT,
    SET_CONTENT_LANGUAGE,
    SET_DISPLAY_UI_EXTENSION_POINTS,
    SET_UI_LANGUAGE_AND_LOCALE,
    SET_UI_LOCALE,
    SET_UI_THEME,
    UPDATE_USER_CHANNELS,
} from '../definitions/client-definitions';

import { BaseDataService } from './base-data.service';

/**
 * Note: local queries all have a fetch-policy of "cache-first" explicitly specified due to:
 * https://github.com/apollographql/apollo-link-state/issues/236
 */
export class ClientDataService {
    constructor(private baseDataService: BaseDataService) {}

    startRequest() {
        return this.baseDataService.mutate<Codegen.RequestStartedMutation>(REQUEST_STARTED);
    }

    completeRequest() {
        return this.baseDataService.mutate<Codegen.RequestCompletedMutation>(REQUEST_COMPLETED);
    }

    getNetworkStatus() {
        return this.baseDataService.query<Codegen.GetNetworkStatusQuery>(
            GET_NEWTORK_STATUS,
            {},
            'cache-first',
        );
    }

    loginSuccess(
        administratorId: string,
        username: string,
        activeChannelId: string,
        channels: CurrentUserChannel[],
    ) {
        return this.baseDataService.mutate<
            Codegen.SetAsLoggedInMutation,
            Codegen.SetAsLoggedInMutationVariables
        >(SET_AS_LOGGED_IN, {
            input: {
                administratorId,
                username,
                loginTime: Date.now().toString(),
                activeChannelId,
                channels,
            },
        });
    }

    logOut() {
        return this.baseDataService.mutate(SET_AS_LOGGED_OUT);
    }

    userStatus() {
        return this.baseDataService.query<Codegen.GetUserStatusQuery>(GET_USER_STATUS, {}, 'cache-first');
    }

    uiState() {
        return this.baseDataService.query<Codegen.GetUiStateQuery>(GET_UI_STATE, {}, 'cache-first');
    }

    setUiLanguage(languageCode: LanguageCode, locale?: string) {
        return this.baseDataService.mutate<
            Codegen.SetUiLanguageMutation,
            Codegen.SetUiLanguageMutationVariables
        >(SET_UI_LANGUAGE_AND_LOCALE, {
            languageCode,
            locale,
        });
    }

    setUiLocale(locale: string | undefined) {
        return this.baseDataService.mutate<Codegen.SetUiLocaleMutation, Codegen.SetUiLocaleMutationVariables>(
            SET_UI_LOCALE,
            {
                locale,
            },
        );
    }

    setContentLanguage(languageCode: LanguageCode) {
        return this.baseDataService.mutate<
            Codegen.SetContentLanguageMutation,
            Codegen.SetContentLanguageMutationVariables
        >(SET_CONTENT_LANGUAGE, {
            languageCode,
        });
    }

    setUiTheme(theme: string) {
        return this.baseDataService.mutate<Codegen.SetUiThemeMutation, Codegen.SetUiThemeMutationVariables>(
            SET_UI_THEME,
            {
                theme,
            },
        );
    }

    setDisplayUiExtensionPoints(display: boolean) {
        return this.baseDataService.mutate<
            Codegen.SetDisplayUiExtensionPointsMutation,
            Codegen.SetDisplayUiExtensionPointsMutationVariables
        >(SET_DISPLAY_UI_EXTENSION_POINTS, {
            display,
        });
    }

    setMainNavExpanded(expanded: boolean) {
        return this.baseDataService.mutate(SetMainNavExpandedDocument, {
            expanded,
        });
    }

    setActiveChannel(channelId: string) {
        return this.baseDataService.mutate<
            Codegen.SetActiveChannelMutation,
            Codegen.SetActiveChannelMutationVariables
        >(SET_ACTIVE_CHANNEL, {
            channelId,
        });
    }

    updateUserChannels(channels: Codegen.CurrentUserChannelInput[]) {
        return this.baseDataService.mutate<
            Codegen.UpdateUserChannelsMutation,
            Codegen.UpdateUserChannelsMutationVariables
        >(UPDATE_USER_CHANNELS, {
            channels,
        });
    }
}
