/*
 * This file contains constants which are shared between more than one sub-module
 * e.g. values required by both the server and admin-ui.
 */
export const API_PORT = 3000;
export const ADMIN_API_PATH = 'admin-api';
export const SHOP_API_PATH = 'shop-api';
export const DEFAULT_CHANNEL_CODE = '__default_channel__';
export const SUPER_ADMIN_ROLE_CODE = '__super_admin_role__';
export const SUPER_ADMIN_ROLE_DESCRIPTION = 'SuperAdmin';
export const SUPER_ADMIN_USER_IDENTIFIER = 'superadmin';
export const SUPER_ADMIN_USER_PASSWORD = 'superadmin';
export const CUSTOMER_ROLE_CODE = '__customer_role__';
export const CUSTOMER_ROLE_DESCRIPTION = 'Customer';
export const ROOT_COLLECTION_NAME = '__root_collection__';
export const DEFAULT_AUTH_TOKEN_HEADER_KEY = 'vendure-auth-token';
export const DEFAULT_APIKEY_HEADER_KEY = 'vendure-api-key';
export const DEFAULT_COOKIE_NAME = 'session';
export const DEFAULT_CHANNEL_TOKEN_KEY = 'vendure-token';

// An environment variable which is set when the @vendure/create
// script is run. Can be used to modify normal behaviour
// to fit with the initial create task.
export type CREATING_VENDURE_APP = 'CREATING_VENDURE_APP';
export const CREATING_VENDURE_APP: CREATING_VENDURE_APP = 'CREATING_VENDURE_APP';
