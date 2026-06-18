import { gql } from 'apollo-angular';

export const REQUEST_STARTED = gql`
    mutation RequestStarted {
        requestStarted @client
    }
`;

export const REQUEST_COMPLETED = gql`
    mutation RequestCompleted {
        requestCompleted @client
    }
`;

export const USER_STATUS_FRAGMENT = gql`
    fragment UserStatus on UserStatus {
        administratorId
        username
        isLoggedIn
        loginTime
        activeChannelId
        permissions
        channels {
            id
            code
            token
            permissions
        }
    }
`;

export const SET_AS_LOGGED_IN = gql`
    mutation SetAsLoggedIn($input: UserStatusInput!) {
        setAsLoggedIn(input: $input) @client {
            ...UserStatus
        }
    }
    ${USER_STATUS_FRAGMENT}
`;

export const SET_AS_LOGGED_OUT = gql`
    mutation SetAsLoggedOut {
        setAsLoggedOut @client {
            ...UserStatus
        }
    }
    ${USER_STATUS_FRAGMENT}
`;

export const SET_UI_LANGUAGE_AND_LOCALE = gql`
    mutation SetUiLanguage($languageCode: LanguageCode!, $locale: String) {
        setUiLanguage(languageCode: $languageCode) @client
        setUiLocale(locale: $locale) @client
    }
`;

export const SET_UI_LOCALE = gql`
    mutation SetUiLocale($locale: String) {
        setUiLocale(locale: $locale) @client
    }
`;

export const SET_DISPLAY_UI_EXTENSION_POINTS = gql`
    mutation SetDisplayUiExtensionPoints($display: Boolean!) {
        setDisplayUiExtensionPoints(display: $display) @client
    }
`;

export const SET_MAIN_NAV_EXPANDED = gql`
    mutation SetMainNavExpanded($expanded: Boolean!) {
        setMainNavExpanded(expanded: $expanded) @client
    }
`;

export const SET_CONTENT_LANGUAGE = gql`
    mutation SetContentLanguage($languageCode: LanguageCode!) {
        setContentLanguage(languageCode: $languageCode) @client
    }
`;

export const SET_UI_THEME = gql`
    mutation SetUiTheme($theme: String!) {
        setUiTheme(theme: $theme) @client
    }
`;

export const GET_NEWTORK_STATUS = gql`
    query GetNetworkStatus {
        networkStatus @client {
            inFlightRequests
        }
    }
`;

export const GET_USER_STATUS = gql`
    query GetUserStatus {
        userStatus @client {
            ...UserStatus
        }
    }
    ${USER_STATUS_FRAGMENT}
`;

export const GET_UI_STATE = gql`
    query GetUiState {
        uiState @client {
            language
            locale
            contentLanguage
            theme
            displayUiExtensionPoints
            mainNavExpanded
        }
    }
`;

export const GET_CLIENT_STATE = gql`
    query GetClientState {
        networkStatus @client {
            inFlightRequests
        }
        userStatus @client {
            ...UserStatus
        }
        uiState @client {
            language
            locale
            contentLanguage
            theme
            displayUiExtensionPoints
            mainNavExpanded
        }
    }
    ${USER_STATUS_FRAGMENT}
`;

export const SET_ACTIVE_CHANNEL = gql`
    mutation SetActiveChannel($channelId: ID!) {
        setActiveChannel(channelId: $channelId) @client {
            ...UserStatus
        }
    }
    ${USER_STATUS_FRAGMENT}
`;

export const UPDATE_USER_CHANNELS = gql`
    mutation UpdateUserChannels($channels: [CurrentUserChannelInput!]!) {
        updateUserChannels(channels: $channels) @client {
            ...UserStatus
        }
    }
    ${USER_STATUS_FRAGMENT}
`;
