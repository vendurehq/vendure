/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> =
    | T
    | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
    ID: { input: string; output: string };
    String: { input: string; output: string };
    Boolean: { input: boolean; output: boolean };
    Int: { input: number; output: number };
    Float: { input: number; output: number };
    DateTime: { input: any; output: any };
    JSON: { input: any; output: any };
    Money: { input: number; output: number };
    Upload: { input: any; output: any };
};

export type ActiveOrderResult = NoActiveOrderError | Order;

export type AddItemInput = {
    productVariantId: Scalars['ID']['input'];
    quantity: Scalars['Int']['input'];
};

export type AddPaymentToOrderResult =
    | IneligiblePaymentMethodError
    | NoActiveOrderError
    | Order
    | OrderPaymentStateError
    | OrderStateTransitionError
    | PaymentDeclinedError
    | PaymentFailedError;

export type Address = Node & {
    city?: Maybe<Scalars['String']['output']>;
    company?: Maybe<Scalars['String']['output']>;
    country: Country;
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    defaultBillingAddress?: Maybe<Scalars['Boolean']['output']>;
    defaultShippingAddress?: Maybe<Scalars['Boolean']['output']>;
    fullName?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    phoneNumber?: Maybe<Scalars['String']['output']>;
    postalCode?: Maybe<Scalars['String']['output']>;
    province?: Maybe<Scalars['String']['output']>;
    streetLine1: Scalars['String']['output'];
    streetLine2?: Maybe<Scalars['String']['output']>;
    updatedAt: Scalars['DateTime']['output'];
};

export type Adjustment = {
    adjustmentSource: Scalars['String']['output'];
    amount: Scalars['Money']['output'];
    data?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    type: AdjustmentType;
};

export enum AdjustmentType {
    DISTRIBUTED_ORDER_PROMOTION = 'DISTRIBUTED_ORDER_PROMOTION',
    OTHER = 'OTHER',
    PROMOTION = 'PROMOTION',
}

/** Returned when attempting to set the Customer for an Order when already logged in. */
export type AlreadyLoggedInError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export type ApplyCouponCodeResult =
    | CouponCodeExpiredError
    | CouponCodeInvalidError
    | CouponCodeLimitError
    | Order;

export type Asset = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    fileSize: Scalars['Int']['output'];
    focalPoint?: Maybe<Coordinate>;
    height: Scalars['Int']['output'];
    id: Scalars['ID']['output'];
    mimeType: Scalars['String']['output'];
    name: Scalars['String']['output'];
    preview: Scalars['String']['output'];
    source: Scalars['String']['output'];
    tags: Array<Tag>;
    type: AssetType;
    updatedAt: Scalars['DateTime']['output'];
    width: Scalars['Int']['output'];
};

export type AssetList = PaginatedList & {
    items: Array<Asset>;
    totalItems: Scalars['Int']['output'];
};

export enum AssetType {
    BINARY = 'BINARY',
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export type AuthenticationInput = {
    native?: InputMaybe<NativeAuthInput>;
};

export type AuthenticationMethod = Node & {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    strategy: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type AuthenticationResult = CurrentUser | InvalidCredentialsError | NotVerifiedError;

export type BooleanCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

/** Operators for filtering on a list of Boolean fields */
export type BooleanListOperators = {
    inList: Scalars['Boolean']['input'];
};

/** Operators for filtering on a Boolean field */
export type BooleanOperators = {
    eq?: InputMaybe<Scalars['Boolean']['input']>;
    isNull?: InputMaybe<Scalars['Boolean']['input']>;
};

export type BooleanStructFieldConfig = StructField & {
    description?: Maybe<Array<LocalizedString>>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type Channel = Node & {
    availableCurrencyCodes: Array<CurrencyCode>;
    availableLanguageCodes?: Maybe<Array<LanguageCode>>;
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    /** @deprecated Use defaultCurrencyCode instead */
    currencyCode: CurrencyCode;
    customFields?: Maybe<Scalars['JSON']['output']>;
    defaultCurrencyCode: CurrencyCode;
    defaultLanguageCode: LanguageCode;
    defaultShippingZone?: Maybe<Zone>;
    defaultTaxZone?: Maybe<Zone>;
    id: Scalars['ID']['output'];
    /** Not yet used - will be implemented in a future release. */
    outOfStockThreshold?: Maybe<Scalars['Int']['output']>;
    pricesIncludeTax: Scalars['Boolean']['output'];
    seller?: Maybe<Seller>;
    token: Scalars['String']['output'];
    /** Not yet used - will be implemented in a future release. */
    trackInventory?: Maybe<Scalars['Boolean']['output']>;
    updatedAt: Scalars['DateTime']['output'];
};

export type Collection = Node & {
    assets: Array<Asset>;
    breadcrumbs: Array<CollectionBreadcrumb>;
    children?: Maybe<Array<Collection>>;
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    featuredAsset?: Maybe<Asset>;
    filters: Array<ConfigurableOperation>;
    id: Scalars['ID']['output'];
    languageCode?: Maybe<LanguageCode>;
    name: Scalars['String']['output'];
    parent?: Maybe<Collection>;
    parentId: Scalars['ID']['output'];
    position: Scalars['Int']['output'];
    productVariants: ProductVariantList;
    slug: Scalars['String']['output'];
    translations: Array<CollectionTranslation>;
    updatedAt: Scalars['DateTime']['output'];
};

export type CollectionProductVariantsArgs = {
    options?: InputMaybe<ProductVariantListOptions>;
};

export type CollectionBreadcrumb = {
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    slug: Scalars['String']['output'];
};

export type CollectionFilterParameter = {
    _and?: InputMaybe<Array<CollectionFilterParameter>>;
    _or?: InputMaybe<Array<CollectionFilterParameter>>;
    createdAt?: InputMaybe<DateOperators>;
    description?: InputMaybe<StringOperators>;
    id?: InputMaybe<IdOperators>;
    languageCode?: InputMaybe<StringOperators>;
    name?: InputMaybe<StringOperators>;
    parentId?: InputMaybe<IdOperators>;
    position?: InputMaybe<NumberOperators>;
    slug?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

export type CollectionList = PaginatedList & {
    items: Array<Collection>;
    totalItems: Scalars['Int']['output'];
};

export type CollectionListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<CollectionFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<CollectionSortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
    topLevelOnly?: InputMaybe<Scalars['Boolean']['input']>;
};

/**
 * Which Collections are present in the products returned
 * by the search, and in what quantity.
 */
export type CollectionResult = {
    collection: Collection;
    count: Scalars['Int']['output'];
};

export type CollectionSortParameter = {
    createdAt?: InputMaybe<SortOrder>;
    description?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    name?: InputMaybe<SortOrder>;
    parentId?: InputMaybe<SortOrder>;
    position?: InputMaybe<SortOrder>;
    slug?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

export type CollectionTranslation = {
    createdAt: Scalars['DateTime']['output'];
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    slug: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type ConfigArg = {
    name: Scalars['String']['output'];
    value: Scalars['String']['output'];
};

export type ConfigArgDefinition = {
    defaultValue?: Maybe<Scalars['JSON']['output']>;
    description?: Maybe<Scalars['String']['output']>;
    label?: Maybe<Scalars['String']['output']>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    required: Scalars['Boolean']['output'];
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type ConfigArgInput = {
    name: Scalars['String']['input'];
    /** A JSON stringified representation of the actual value */
    value: Scalars['String']['input'];
};

export type ConfigurableOperation = {
    args: Array<ConfigArg>;
    code: Scalars['String']['output'];
};

export type ConfigurableOperationDefinition = {
    args: Array<ConfigArgDefinition>;
    code: Scalars['String']['output'];
    description: Scalars['String']['output'];
};

export type ConfigurableOperationInput = {
    arguments: Array<ConfigArgInput>;
    code: Scalars['String']['input'];
};

export type Coordinate = {
    x: Scalars['Float']['output'];
    y: Scalars['Float']['output'];
};

/**
 * A Country of the world which your shop operates in.
 *
 * The `code` field is typically a 2-character ISO code such as "GB", "US", "DE" etc. This code is used in certain inputs such as
 * `UpdateAddressInput` and `CreateAddressInput` to specify the country.
 */
export type Country = Node &
    Region & {
        code: Scalars['String']['output'];
        createdAt: Scalars['DateTime']['output'];
        customFields?: Maybe<Scalars['JSON']['output']>;
        enabled: Scalars['Boolean']['output'];
        id: Scalars['ID']['output'];
        languageCode: LanguageCode;
        name: Scalars['String']['output'];
        parent?: Maybe<Region>;
        parentId?: Maybe<Scalars['ID']['output']>;
        translations: Array<RegionTranslation>;
        type: Scalars['String']['output'];
        updatedAt: Scalars['DateTime']['output'];
    };

export type CountryList = PaginatedList & {
    items: Array<Country>;
    totalItems: Scalars['Int']['output'];
};

/** Returned if the provided coupon code is invalid */
export type CouponCodeExpiredError = ErrorResult & {
    couponCode: Scalars['String']['output'];
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Returned if the provided coupon code is invalid */
export type CouponCodeInvalidError = ErrorResult & {
    couponCode: Scalars['String']['output'];
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Returned if the provided coupon code is invalid */
export type CouponCodeLimitError = ErrorResult & {
    couponCode: Scalars['String']['output'];
    errorCode: ErrorCode;
    limit: Scalars['Int']['output'];
    message: Scalars['String']['output'];
};

/**
 * Input used to create an Address.
 *
 * The countryCode must correspond to a `code` property of a Country that has been defined in the
 * Vendure server. The `code` property is typically a 2-character ISO code such as "GB", "US", "DE" etc.
 * If an invalid code is passed, the mutation will fail.
 */
export type CreateAddressInput = {
    city?: InputMaybe<Scalars['String']['input']>;
    company?: InputMaybe<Scalars['String']['input']>;
    countryCode: Scalars['String']['input'];
    customFields?: InputMaybe<Scalars['JSON']['input']>;
    defaultBillingAddress?: InputMaybe<Scalars['Boolean']['input']>;
    defaultShippingAddress?: InputMaybe<Scalars['Boolean']['input']>;
    fullName?: InputMaybe<Scalars['String']['input']>;
    phoneNumber?: InputMaybe<Scalars['String']['input']>;
    postalCode?: InputMaybe<Scalars['String']['input']>;
    province?: InputMaybe<Scalars['String']['input']>;
    streetLine1: Scalars['String']['input'];
    streetLine2?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCustomerInput = {
    customFields?: InputMaybe<Scalars['JSON']['input']>;
    emailAddress: Scalars['String']['input'];
    firstName: Scalars['String']['input'];
    lastName: Scalars['String']['input'];
    phoneNumber?: InputMaybe<Scalars['String']['input']>;
    title?: InputMaybe<Scalars['String']['input']>;
};

/**
 * @description
 * ISO 4217 currency code
 *
 * @docsCategory common
 */
export enum CurrencyCode {
    /** United Arab Emirates dirham */
    AED = 'AED',
    /** Afghan afghani */
    AFN = 'AFN',
    /** Albanian lek */
    ALL = 'ALL',
    /** Armenian dram */
    AMD = 'AMD',
    /** Netherlands Antillean guilder */
    ANG = 'ANG',
    /** Angolan kwanza */
    AOA = 'AOA',
    /** Argentine peso */
    ARS = 'ARS',
    /** Australian dollar */
    AUD = 'AUD',
    /** Aruban florin */
    AWG = 'AWG',
    /** Azerbaijani manat */
    AZN = 'AZN',
    /** Bosnia and Herzegovina convertible mark */
    BAM = 'BAM',
    /** Barbados dollar */
    BBD = 'BBD',
    /** Bangladeshi taka */
    BDT = 'BDT',
    /** Bulgarian lev */
    BGN = 'BGN',
    /** Bahraini dinar */
    BHD = 'BHD',
    /** Burundian franc */
    BIF = 'BIF',
    /** Bermudian dollar */
    BMD = 'BMD',
    /** Brunei dollar */
    BND = 'BND',
    /** Boliviano */
    BOB = 'BOB',
    /** Brazilian real */
    BRL = 'BRL',
    /** Bahamian dollar */
    BSD = 'BSD',
    /** Bhutanese ngultrum */
    BTN = 'BTN',
    /** Botswana pula */
    BWP = 'BWP',
    /** Belarusian ruble */
    BYN = 'BYN',
    /** Belize dollar */
    BZD = 'BZD',
    /** Canadian dollar */
    CAD = 'CAD',
    /** Congolese franc */
    CDF = 'CDF',
    /** Swiss franc */
    CHF = 'CHF',
    /** Chilean peso */
    CLP = 'CLP',
    /** Renminbi (Chinese) yuan */
    CNY = 'CNY',
    /** Colombian peso */
    COP = 'COP',
    /** Costa Rican colon */
    CRC = 'CRC',
    /** Cuban convertible peso */
    CUC = 'CUC',
    /** Cuban peso */
    CUP = 'CUP',
    /** Cape Verde escudo */
    CVE = 'CVE',
    /** Czech koruna */
    CZK = 'CZK',
    /** Djiboutian franc */
    DJF = 'DJF',
    /** Danish krone */
    DKK = 'DKK',
    /** Dominican peso */
    DOP = 'DOP',
    /** Algerian dinar */
    DZD = 'DZD',
    /** Egyptian pound */
    EGP = 'EGP',
    /** Eritrean nakfa */
    ERN = 'ERN',
    /** Ethiopian birr */
    ETB = 'ETB',
    /** Euro */
    EUR = 'EUR',
    /** Fiji dollar */
    FJD = 'FJD',
    /** Falkland Islands pound */
    FKP = 'FKP',
    /** Pound sterling */
    GBP = 'GBP',
    /** Georgian lari */
    GEL = 'GEL',
    /** Ghanaian cedi */
    GHS = 'GHS',
    /** Gibraltar pound */
    GIP = 'GIP',
    /** Gambian dalasi */
    GMD = 'GMD',
    /** Guinean franc */
    GNF = 'GNF',
    /** Guatemalan quetzal */
    GTQ = 'GTQ',
    /** Guyanese dollar */
    GYD = 'GYD',
    /** Hong Kong dollar */
    HKD = 'HKD',
    /** Honduran lempira */
    HNL = 'HNL',
    /** Croatian kuna */
    HRK = 'HRK',
    /** Haitian gourde */
    HTG = 'HTG',
    /** Hungarian forint */
    HUF = 'HUF',
    /** Indonesian rupiah */
    IDR = 'IDR',
    /** Israeli new shekel */
    ILS = 'ILS',
    /** Indian rupee */
    INR = 'INR',
    /** Iraqi dinar */
    IQD = 'IQD',
    /** Iranian rial */
    IRR = 'IRR',
    /** Icelandic króna */
    ISK = 'ISK',
    /** Jamaican dollar */
    JMD = 'JMD',
    /** Jordanian dinar */
    JOD = 'JOD',
    /** Japanese yen */
    JPY = 'JPY',
    /** Kenyan shilling */
    KES = 'KES',
    /** Kyrgyzstani som */
    KGS = 'KGS',
    /** Cambodian riel */
    KHR = 'KHR',
    /** Comoro franc */
    KMF = 'KMF',
    /** North Korean won */
    KPW = 'KPW',
    /** South Korean won */
    KRW = 'KRW',
    /** Kuwaiti dinar */
    KWD = 'KWD',
    /** Cayman Islands dollar */
    KYD = 'KYD',
    /** Kazakhstani tenge */
    KZT = 'KZT',
    /** Lao kip */
    LAK = 'LAK',
    /** Lebanese pound */
    LBP = 'LBP',
    /** Sri Lankan rupee */
    LKR = 'LKR',
    /** Liberian dollar */
    LRD = 'LRD',
    /** Lesotho loti */
    LSL = 'LSL',
    /** Libyan dinar */
    LYD = 'LYD',
    /** Moroccan dirham */
    MAD = 'MAD',
    /** Moldovan leu */
    MDL = 'MDL',
    /** Malagasy ariary */
    MGA = 'MGA',
    /** Macedonian denar */
    MKD = 'MKD',
    /** Myanmar kyat */
    MMK = 'MMK',
    /** Mongolian tögrög */
    MNT = 'MNT',
    /** Macanese pataca */
    MOP = 'MOP',
    /** Mauritanian ouguiya */
    MRU = 'MRU',
    /** Mauritian rupee */
    MUR = 'MUR',
    /** Maldivian rufiyaa */
    MVR = 'MVR',
    /** Malawian kwacha */
    MWK = 'MWK',
    /** Mexican peso */
    MXN = 'MXN',
    /** Malaysian ringgit */
    MYR = 'MYR',
    /** Mozambican metical */
    MZN = 'MZN',
    /** Namibian dollar */
    NAD = 'NAD',
    /** Nigerian naira */
    NGN = 'NGN',
    /** Nicaraguan córdoba */
    NIO = 'NIO',
    /** Norwegian krone */
    NOK = 'NOK',
    /** Nepalese rupee */
    NPR = 'NPR',
    /** New Zealand dollar */
    NZD = 'NZD',
    /** Omani rial */
    OMR = 'OMR',
    /** Panamanian balboa */
    PAB = 'PAB',
    /** Peruvian sol */
    PEN = 'PEN',
    /** Papua New Guinean kina */
    PGK = 'PGK',
    /** Philippine peso */
    PHP = 'PHP',
    /** Pakistani rupee */
    PKR = 'PKR',
    /** Polish złoty */
    PLN = 'PLN',
    /** Paraguayan guaraní */
    PYG = 'PYG',
    /** Qatari riyal */
    QAR = 'QAR',
    /** Romanian leu */
    RON = 'RON',
    /** Serbian dinar */
    RSD = 'RSD',
    /** Russian ruble */
    RUB = 'RUB',
    /** Rwandan franc */
    RWF = 'RWF',
    /** Saudi riyal */
    SAR = 'SAR',
    /** Solomon Islands dollar */
    SBD = 'SBD',
    /** Seychelles rupee */
    SCR = 'SCR',
    /** Sudanese pound */
    SDG = 'SDG',
    /** Swedish krona/kronor */
    SEK = 'SEK',
    /** Singapore dollar */
    SGD = 'SGD',
    /** Saint Helena pound */
    SHP = 'SHP',
    /** Sierra Leonean leone */
    SLL = 'SLL',
    /** Somali shilling */
    SOS = 'SOS',
    /** Surinamese dollar */
    SRD = 'SRD',
    /** South Sudanese pound */
    SSP = 'SSP',
    /** São Tomé and Príncipe dobra */
    STN = 'STN',
    /** Salvadoran colón */
    SVC = 'SVC',
    /** Syrian pound */
    SYP = 'SYP',
    /** Swazi lilangeni */
    SZL = 'SZL',
    /** Thai baht */
    THB = 'THB',
    /** Tajikistani somoni */
    TJS = 'TJS',
    /** Turkmenistan manat */
    TMT = 'TMT',
    /** Tunisian dinar */
    TND = 'TND',
    /** Tongan paʻanga */
    TOP = 'TOP',
    /** Turkish lira */
    TRY = 'TRY',
    /** Trinidad and Tobago dollar */
    TTD = 'TTD',
    /** New Taiwan dollar */
    TWD = 'TWD',
    /** Tanzanian shilling */
    TZS = 'TZS',
    /** Ukrainian hryvnia */
    UAH = 'UAH',
    /** Ugandan shilling */
    UGX = 'UGX',
    /** United States dollar */
    USD = 'USD',
    /** Uruguayan peso */
    UYU = 'UYU',
    /** Uzbekistan som */
    UZS = 'UZS',
    /** Venezuelan bolívar soberano */
    VES = 'VES',
    /** Vietnamese đồng */
    VND = 'VND',
    /** Vanuatu vatu */
    VUV = 'VUV',
    /** Samoan tala */
    WST = 'WST',
    /** CFA franc BEAC */
    XAF = 'XAF',
    /** East Caribbean dollar */
    XCD = 'XCD',
    /** CFA franc BCEAO */
    XOF = 'XOF',
    /** CFP franc (franc Pacifique) */
    XPF = 'XPF',
    /** Yemeni rial */
    YER = 'YER',
    /** South African rand */
    ZAR = 'ZAR',
    /** Zambian kwacha */
    ZMW = 'ZMW',
    /** Zimbabwean dollar */
    ZWL = 'ZWL',
}

export type CurrentUser = {
    channels: Array<CurrentUserChannel>;
    id: Scalars['ID']['output'];
    identifier: Scalars['String']['output'];
};

export type CurrentUserChannel = {
    code: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    permissions: Array<Permission>;
    token: Scalars['String']['output'];
};

export type CustomField = {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type CustomFieldConfig =
    | BooleanCustomFieldConfig
    | DateTimeCustomFieldConfig
    | FloatCustomFieldConfig
    | IntCustomFieldConfig
    | LocaleStringCustomFieldConfig
    | LocaleTextCustomFieldConfig
    | RelationCustomFieldConfig
    | StringCustomFieldConfig
    | StructCustomFieldConfig
    | TextCustomFieldConfig;

export type Customer = Node & {
    addresses?: Maybe<Array<Address>>;
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    emailAddress: Scalars['String']['output'];
    firstName: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    lastName: Scalars['String']['output'];
    orders: OrderList;
    phoneNumber?: Maybe<Scalars['String']['output']>;
    title?: Maybe<Scalars['String']['output']>;
    updatedAt: Scalars['DateTime']['output'];
    user?: Maybe<User>;
};

export type CustomerOrdersArgs = {
    options?: InputMaybe<OrderListOptions>;
};

export type CustomerFilterParameter = {
    _and?: InputMaybe<Array<CustomerFilterParameter>>;
    _or?: InputMaybe<Array<CustomerFilterParameter>>;
    createdAt?: InputMaybe<DateOperators>;
    emailAddress?: InputMaybe<StringOperators>;
    firstName?: InputMaybe<StringOperators>;
    id?: InputMaybe<IdOperators>;
    lastName?: InputMaybe<StringOperators>;
    phoneNumber?: InputMaybe<StringOperators>;
    title?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

export type CustomerGroup = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    customers: CustomerList;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type CustomerGroupCustomersArgs = {
    options?: InputMaybe<CustomerListOptions>;
};

export type CustomerList = PaginatedList & {
    items: Array<Customer>;
    totalItems: Scalars['Int']['output'];
};

export type CustomerListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<CustomerFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<CustomerSortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
};

export type CustomerSortParameter = {
    createdAt?: InputMaybe<SortOrder>;
    emailAddress?: InputMaybe<SortOrder>;
    firstName?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    lastName?: InputMaybe<SortOrder>;
    phoneNumber?: InputMaybe<SortOrder>;
    title?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

/** Operators for filtering on a list of Date fields */
export type DateListOperators = {
    inList: Scalars['DateTime']['input'];
};

/** Operators for filtering on a DateTime field */
export type DateOperators = {
    after?: InputMaybe<Scalars['DateTime']['input']>;
    before?: InputMaybe<Scalars['DateTime']['input']>;
    between?: InputMaybe<DateRange>;
    eq?: InputMaybe<Scalars['DateTime']['input']>;
    isNull?: InputMaybe<Scalars['Boolean']['input']>;
};

export type DateRange = {
    end: Scalars['DateTime']['input'];
    start: Scalars['DateTime']['input'];
};

/**
 * Expects the same validation formats as the `<input type="datetime-local">` HTML element.
 * See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local#Additional_attributes
 */
export type DateTimeCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    max?: Maybe<Scalars['String']['output']>;
    min?: Maybe<Scalars['String']['output']>;
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    step?: Maybe<Scalars['Int']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

/**
 * Expects the same validation formats as the `<input type="datetime-local">` HTML element.
 * See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local#Additional_attributes
 */
export type DateTimeStructFieldConfig = StructField & {
    description?: Maybe<Array<LocalizedString>>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    max?: Maybe<Scalars['String']['output']>;
    min?: Maybe<Scalars['String']['output']>;
    name: Scalars['String']['output'];
    step?: Maybe<Scalars['Int']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type DeletionResponse = {
    message?: Maybe<Scalars['String']['output']>;
    result: DeletionResult;
};

export enum DeletionResult {
    /** The entity was successfully deleted */
    DELETED = 'DELETED',
    /** Deletion did not take place, reason given in message */
    NOT_DELETED = 'NOT_DELETED',
}

export type Discount = {
    adjustmentSource: Scalars['String']['output'];
    amount: Scalars['Money']['output'];
    amountWithTax: Scalars['Money']['output'];
    description: Scalars['String']['output'];
    type: AdjustmentType;
};

/** Returned when attempting to create a Customer with an email address already registered to an existing User. */
export type EmailAddressConflictError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export enum ErrorCode {
    ALREADY_LOGGED_IN_ERROR = 'ALREADY_LOGGED_IN_ERROR',
    COUPON_CODE_EXPIRED_ERROR = 'COUPON_CODE_EXPIRED_ERROR',
    COUPON_CODE_INVALID_ERROR = 'COUPON_CODE_INVALID_ERROR',
    COUPON_CODE_LIMIT_ERROR = 'COUPON_CODE_LIMIT_ERROR',
    EMAIL_ADDRESS_CONFLICT_ERROR = 'EMAIL_ADDRESS_CONFLICT_ERROR',
    GUEST_CHECKOUT_ERROR = 'GUEST_CHECKOUT_ERROR',
    IDENTIFIER_CHANGE_TOKEN_EXPIRED_ERROR = 'IDENTIFIER_CHANGE_TOKEN_EXPIRED_ERROR',
    IDENTIFIER_CHANGE_TOKEN_INVALID_ERROR = 'IDENTIFIER_CHANGE_TOKEN_INVALID_ERROR',
    INELIGIBLE_PAYMENT_METHOD_ERROR = 'INELIGIBLE_PAYMENT_METHOD_ERROR',
    INELIGIBLE_SHIPPING_METHOD_ERROR = 'INELIGIBLE_SHIPPING_METHOD_ERROR',
    INSUFFICIENT_STOCK_ERROR = 'INSUFFICIENT_STOCK_ERROR',
    INVALID_CREDENTIALS_ERROR = 'INVALID_CREDENTIALS_ERROR',
    MISSING_PASSWORD_ERROR = 'MISSING_PASSWORD_ERROR',
    NATIVE_AUTH_STRATEGY_ERROR = 'NATIVE_AUTH_STRATEGY_ERROR',
    NEGATIVE_QUANTITY_ERROR = 'NEGATIVE_QUANTITY_ERROR',
    NOT_VERIFIED_ERROR = 'NOT_VERIFIED_ERROR',
    NO_ACTIVE_ORDER_ERROR = 'NO_ACTIVE_ORDER_ERROR',
    ORDER_INTERCEPTOR_ERROR = 'ORDER_INTERCEPTOR_ERROR',
    ORDER_LIMIT_ERROR = 'ORDER_LIMIT_ERROR',
    ORDER_MODIFICATION_ERROR = 'ORDER_MODIFICATION_ERROR',
    ORDER_PAYMENT_STATE_ERROR = 'ORDER_PAYMENT_STATE_ERROR',
    ORDER_STATE_TRANSITION_ERROR = 'ORDER_STATE_TRANSITION_ERROR',
    PASSWORD_ALREADY_SET_ERROR = 'PASSWORD_ALREADY_SET_ERROR',
    PASSWORD_RESET_TOKEN_EXPIRED_ERROR = 'PASSWORD_RESET_TOKEN_EXPIRED_ERROR',
    PASSWORD_RESET_TOKEN_INVALID_ERROR = 'PASSWORD_RESET_TOKEN_INVALID_ERROR',
    PASSWORD_VALIDATION_ERROR = 'PASSWORD_VALIDATION_ERROR',
    PAYMENT_DECLINED_ERROR = 'PAYMENT_DECLINED_ERROR',
    PAYMENT_FAILED_ERROR = 'PAYMENT_FAILED_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    VERIFICATION_TOKEN_EXPIRED_ERROR = 'VERIFICATION_TOKEN_EXPIRED_ERROR',
    VERIFICATION_TOKEN_INVALID_ERROR = 'VERIFICATION_TOKEN_INVALID_ERROR',
}

export type ErrorResult = {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export type Facet = Node & {
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    translations: Array<FacetTranslation>;
    updatedAt: Scalars['DateTime']['output'];
    /** Returns a paginated, sortable, filterable list of the Facet's values. Added in v2.1.0. */
    valueList: FacetValueList;
    values: Array<FacetValue>;
};

export type FacetValueListArgs = {
    options?: InputMaybe<FacetValueListOptions>;
};

export type FacetFilterParameter = {
    _and?: InputMaybe<Array<FacetFilterParameter>>;
    _or?: InputMaybe<Array<FacetFilterParameter>>;
    code?: InputMaybe<StringOperators>;
    createdAt?: InputMaybe<DateOperators>;
    id?: InputMaybe<IdOperators>;
    languageCode?: InputMaybe<StringOperators>;
    name?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

export type FacetList = PaginatedList & {
    items: Array<Facet>;
    totalItems: Scalars['Int']['output'];
};

export type FacetListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<FacetFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<FacetSortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
};

export type FacetSortParameter = {
    code?: InputMaybe<SortOrder>;
    createdAt?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    name?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

export type FacetTranslation = {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type FacetValue = Node & {
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    facet: Facet;
    facetId: Scalars['ID']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    translations: Array<FacetValueTranslation>;
    updatedAt: Scalars['DateTime']['output'];
};

/**
 * Used to construct boolean expressions for filtering search results
 * by FacetValue ID. Examples:
 *
 * * ID=1 OR ID=2: `{ facetValueFilters: [{ or: [1,2] }] }`
 * * ID=1 AND ID=2: `{ facetValueFilters: [{ and: 1 }, { and: 2 }] }`
 * * ID=1 AND (ID=2 OR ID=3): `{ facetValueFilters: [{ and: 1 }, { or: [2,3] }] }`
 */
export type FacetValueFilterInput = {
    and?: InputMaybe<Scalars['ID']['input']>;
    or?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type FacetValueFilterParameter = {
    _and?: InputMaybe<Array<FacetValueFilterParameter>>;
    _or?: InputMaybe<Array<FacetValueFilterParameter>>;
    code?: InputMaybe<StringOperators>;
    createdAt?: InputMaybe<DateOperators>;
    facetId?: InputMaybe<IdOperators>;
    id?: InputMaybe<IdOperators>;
    languageCode?: InputMaybe<StringOperators>;
    name?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

export type FacetValueList = PaginatedList & {
    items: Array<FacetValue>;
    totalItems: Scalars['Int']['output'];
};

export type FacetValueListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<FacetValueFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<FacetValueSortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
};

/**
 * Which FacetValues are present in the products returned
 * by the search, and in what quantity.
 */
export type FacetValueResult = {
    count: Scalars['Int']['output'];
    facetValue: FacetValue;
};

export type FacetValueSortParameter = {
    code?: InputMaybe<SortOrder>;
    createdAt?: InputMaybe<SortOrder>;
    facetId?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    name?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

export type FacetValueTranslation = {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type FloatCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    max?: Maybe<Scalars['Float']['output']>;
    min?: Maybe<Scalars['Float']['output']>;
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    step?: Maybe<Scalars['Float']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type FloatStructFieldConfig = StructField & {
    description?: Maybe<Array<LocalizedString>>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    max?: Maybe<Scalars['Float']['output']>;
    min?: Maybe<Scalars['Float']['output']>;
    name: Scalars['String']['output'];
    step?: Maybe<Scalars['Float']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type Fulfillment = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    lines: Array<FulfillmentLine>;
    method: Scalars['String']['output'];
    state: Scalars['String']['output'];
    /** @deprecated Use the `lines` field instead */
    summary: Array<FulfillmentLine>;
    trackingCode?: Maybe<Scalars['String']['output']>;
    updatedAt: Scalars['DateTime']['output'];
};

export type FulfillmentLine = {
    fulfillment: Fulfillment;
    fulfillmentId: Scalars['ID']['output'];
    orderLine: OrderLine;
    orderLineId: Scalars['ID']['output'];
    quantity: Scalars['Int']['output'];
};

export enum GlobalFlag {
    FALSE = 'FALSE',
    INHERIT = 'INHERIT',
    TRUE = 'TRUE',
}

/** Returned when attempting to set the Customer on a guest checkout when the configured GuestCheckoutStrategy does not allow it. */
export type GuestCheckoutError = ErrorResult & {
    errorCode: ErrorCode;
    errorDetail: Scalars['String']['output'];
    message: Scalars['String']['output'];
};

export type HistoryEntry = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    data: Scalars['JSON']['output'];
    id: Scalars['ID']['output'];
    type: HistoryEntryType;
    updatedAt: Scalars['DateTime']['output'];
};

export type HistoryEntryFilterParameter = {
    _and?: InputMaybe<Array<HistoryEntryFilterParameter>>;
    _or?: InputMaybe<Array<HistoryEntryFilterParameter>>;
    createdAt?: InputMaybe<DateOperators>;
    id?: InputMaybe<IdOperators>;
    type?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

export type HistoryEntryList = PaginatedList & {
    items: Array<HistoryEntry>;
    totalItems: Scalars['Int']['output'];
};

export type HistoryEntryListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<HistoryEntryFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<HistoryEntrySortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
};

export type HistoryEntrySortParameter = {
    createdAt?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

export enum HistoryEntryType {
    CUSTOMER_ADDED_TO_GROUP = 'CUSTOMER_ADDED_TO_GROUP',
    CUSTOMER_ADDRESS_CREATED = 'CUSTOMER_ADDRESS_CREATED',
    CUSTOMER_ADDRESS_DELETED = 'CUSTOMER_ADDRESS_DELETED',
    CUSTOMER_ADDRESS_UPDATED = 'CUSTOMER_ADDRESS_UPDATED',
    CUSTOMER_DETAIL_UPDATED = 'CUSTOMER_DETAIL_UPDATED',
    CUSTOMER_EMAIL_UPDATE_REQUESTED = 'CUSTOMER_EMAIL_UPDATE_REQUESTED',
    CUSTOMER_EMAIL_UPDATE_VERIFIED = 'CUSTOMER_EMAIL_UPDATE_VERIFIED',
    CUSTOMER_NOTE = 'CUSTOMER_NOTE',
    CUSTOMER_PASSWORD_RESET_REQUESTED = 'CUSTOMER_PASSWORD_RESET_REQUESTED',
    CUSTOMER_PASSWORD_RESET_VERIFIED = 'CUSTOMER_PASSWORD_RESET_VERIFIED',
    CUSTOMER_PASSWORD_UPDATED = 'CUSTOMER_PASSWORD_UPDATED',
    CUSTOMER_REGISTERED = 'CUSTOMER_REGISTERED',
    CUSTOMER_REMOVED_FROM_GROUP = 'CUSTOMER_REMOVED_FROM_GROUP',
    CUSTOMER_VERIFIED = 'CUSTOMER_VERIFIED',
    ORDER_CANCELLATION = 'ORDER_CANCELLATION',
    ORDER_COUPON_APPLIED = 'ORDER_COUPON_APPLIED',
    ORDER_COUPON_REMOVED = 'ORDER_COUPON_REMOVED',
    ORDER_CURRENCY_UPDATED = 'ORDER_CURRENCY_UPDATED',
    ORDER_CUSTOMER_UPDATED = 'ORDER_CUSTOMER_UPDATED',
    ORDER_FULFILLMENT = 'ORDER_FULFILLMENT',
    ORDER_FULFILLMENT_TRANSITION = 'ORDER_FULFILLMENT_TRANSITION',
    ORDER_MODIFIED = 'ORDER_MODIFIED',
    ORDER_NOTE = 'ORDER_NOTE',
    ORDER_PAYMENT_TRANSITION = 'ORDER_PAYMENT_TRANSITION',
    ORDER_REFUND_TRANSITION = 'ORDER_REFUND_TRANSITION',
    ORDER_STATE_TRANSITION = 'ORDER_STATE_TRANSITION',
}

/** Operators for filtering on a list of ID fields */
export type IdListOperators = {
    inList: Scalars['ID']['input'];
};

/** Operators for filtering on an ID field */
export type IdOperators = {
    eq?: InputMaybe<Scalars['String']['input']>;
    in?: InputMaybe<Array<Scalars['String']['input']>>;
    isNull?: InputMaybe<Scalars['Boolean']['input']>;
    notEq?: InputMaybe<Scalars['String']['input']>;
    notIn?: InputMaybe<Array<Scalars['String']['input']>>;
};

/**
 * Returned if the token used to change a Customer's email address is valid, but has
 * expired according to the `verificationTokenDuration` setting in the AuthOptions.
 */
export type IdentifierChangeTokenExpiredError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/**
 * Returned if the token used to change a Customer's email address is either
 * invalid or does not match any expected tokens.
 */
export type IdentifierChangeTokenInvalidError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Returned when attempting to add a Payment using a PaymentMethod for which the Order is not eligible. */
export type IneligiblePaymentMethodError = ErrorResult & {
    eligibilityCheckerMessage?: Maybe<Scalars['String']['output']>;
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Returned when attempting to set a ShippingMethod for which the Order is not eligible */
export type IneligibleShippingMethodError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Returned when attempting to add more items to the Order than are available */
export type InsufficientStockError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
    order: Order;
    quantityAvailable: Scalars['Int']['output'];
};

export type IntCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    max?: Maybe<Scalars['Int']['output']>;
    min?: Maybe<Scalars['Int']['output']>;
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    step?: Maybe<Scalars['Int']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type IntStructFieldConfig = StructField & {
    description?: Maybe<Array<LocalizedString>>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    max?: Maybe<Scalars['Int']['output']>;
    min?: Maybe<Scalars['Int']['output']>;
    name: Scalars['String']['output'];
    step?: Maybe<Scalars['Int']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

/** Returned if the user authentication credentials are not valid */
export type InvalidCredentialsError = ErrorResult & {
    authenticationError: Scalars['String']['output'];
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/**
 * @description
 * Languages in the form of a ISO 639-1 language code with optional
 * region or script modifier (e.g. de_AT). The selection available is based
 * on the [Unicode CLDR summary list](https://unicode-org.github.io/cldr-staging/charts/37/summary/root.html)
 * and includes the major spoken languages of the world and any widely-used variants.
 *
 * @docsCategory common
 */
export enum LanguageCode {
    /** Afrikaans */
    af = 'af',
    /** Akan */
    ak = 'ak',
    /** Amharic */
    am = 'am',
    /** Arabic */
    ar = 'ar',
    /** Assamese */
    as = 'as',
    /** Azerbaijani */
    az = 'az',
    /** Belarusian */
    be = 'be',
    /** Bulgarian */
    bg = 'bg',
    /** Bambara */
    bm = 'bm',
    /** Bangla */
    bn = 'bn',
    /** Tibetan */
    bo = 'bo',
    /** Breton */
    br = 'br',
    /** Bosnian */
    bs = 'bs',
    /** Catalan */
    ca = 'ca',
    /** Chechen */
    ce = 'ce',
    /** Corsican */
    co = 'co',
    /** Czech */
    cs = 'cs',
    /** Church Slavic */
    cu = 'cu',
    /** Welsh */
    cy = 'cy',
    /** Danish */
    da = 'da',
    /** German */
    de = 'de',
    /** Austrian German */
    de_AT = 'de_AT',
    /** Swiss High German */
    de_CH = 'de_CH',
    /** Dzongkha */
    dz = 'dz',
    /** Ewe */
    ee = 'ee',
    /** Greek */
    el = 'el',
    /** English */
    en = 'en',
    /** Australian English */
    en_AU = 'en_AU',
    /** Canadian English */
    en_CA = 'en_CA',
    /** British English */
    en_GB = 'en_GB',
    /** American English */
    en_US = 'en_US',
    /** Esperanto */
    eo = 'eo',
    /** Spanish */
    es = 'es',
    /** European Spanish */
    es_ES = 'es_ES',
    /** Mexican Spanish */
    es_MX = 'es_MX',
    /** Estonian */
    et = 'et',
    /** Basque */
    eu = 'eu',
    /** Persian */
    fa = 'fa',
    /** Dari */
    fa_AF = 'fa_AF',
    /** Fulah */
    ff = 'ff',
    /** Finnish */
    fi = 'fi',
    /** Faroese */
    fo = 'fo',
    /** French */
    fr = 'fr',
    /** Canadian French */
    fr_CA = 'fr_CA',
    /** Swiss French */
    fr_CH = 'fr_CH',
    /** Western Frisian */
    fy = 'fy',
    /** Irish */
    ga = 'ga',
    /** Scottish Gaelic */
    gd = 'gd',
    /** Galician */
    gl = 'gl',
    /** Gujarati */
    gu = 'gu',
    /** Manx */
    gv = 'gv',
    /** Hausa */
    ha = 'ha',
    /** Hebrew */
    he = 'he',
    /** Hindi */
    hi = 'hi',
    /** Croatian */
    hr = 'hr',
    /** Haitian Creole */
    ht = 'ht',
    /** Hungarian */
    hu = 'hu',
    /** Armenian */
    hy = 'hy',
    /** Interlingua */
    ia = 'ia',
    /** Indonesian */
    id = 'id',
    /** Igbo */
    ig = 'ig',
    /** Sichuan Yi */
    ii = 'ii',
    /** Icelandic */
    is = 'is',
    /** Italian */
    it = 'it',
    /** Japanese */
    ja = 'ja',
    /** Javanese */
    jv = 'jv',
    /** Georgian */
    ka = 'ka',
    /** Kikuyu */
    ki = 'ki',
    /** Kazakh */
    kk = 'kk',
    /** Kalaallisut */
    kl = 'kl',
    /** Khmer */
    km = 'km',
    /** Kannada */
    kn = 'kn',
    /** Korean */
    ko = 'ko',
    /** Kashmiri */
    ks = 'ks',
    /** Kurdish */
    ku = 'ku',
    /** Cornish */
    kw = 'kw',
    /** Kyrgyz */
    ky = 'ky',
    /** Latin */
    la = 'la',
    /** Luxembourgish */
    lb = 'lb',
    /** Ganda */
    lg = 'lg',
    /** Lingala */
    ln = 'ln',
    /** Lao */
    lo = 'lo',
    /** Lithuanian */
    lt = 'lt',
    /** Luba-Katanga */
    lu = 'lu',
    /** Latvian */
    lv = 'lv',
    /** Malagasy */
    mg = 'mg',
    /** Maori */
    mi = 'mi',
    /** Macedonian */
    mk = 'mk',
    /** Malayalam */
    ml = 'ml',
    /** Mongolian */
    mn = 'mn',
    /** Marathi */
    mr = 'mr',
    /** Malay */
    ms = 'ms',
    /** Maltese */
    mt = 'mt',
    /** Burmese */
    my = 'my',
    /** Norwegian Bokmål */
    nb = 'nb',
    /** North Ndebele */
    nd = 'nd',
    /** Nepali */
    ne = 'ne',
    /** Dutch */
    nl = 'nl',
    /** Flemish */
    nl_BE = 'nl_BE',
    /** Norwegian Nynorsk */
    nn = 'nn',
    /** Nyanja */
    ny = 'ny',
    /** Oromo */
    om = 'om',
    /** Odia */
    or = 'or',
    /** Ossetic */
    os = 'os',
    /** Punjabi */
    pa = 'pa',
    /** Polish */
    pl = 'pl',
    /** Pashto */
    ps = 'ps',
    /** Portuguese */
    pt = 'pt',
    /** Brazilian Portuguese */
    pt_BR = 'pt_BR',
    /** European Portuguese */
    pt_PT = 'pt_PT',
    /** Quechua */
    qu = 'qu',
    /** Romansh */
    rm = 'rm',
    /** Rundi */
    rn = 'rn',
    /** Romanian */
    ro = 'ro',
    /** Moldavian */
    ro_MD = 'ro_MD',
    /** Russian */
    ru = 'ru',
    /** Kinyarwanda */
    rw = 'rw',
    /** Sanskrit */
    sa = 'sa',
    /** Sindhi */
    sd = 'sd',
    /** Northern Sami */
    se = 'se',
    /** Sango */
    sg = 'sg',
    /** Sinhala */
    si = 'si',
    /** Slovak */
    sk = 'sk',
    /** Slovenian */
    sl = 'sl',
    /** Samoan */
    sm = 'sm',
    /** Shona */
    sn = 'sn',
    /** Somali */
    so = 'so',
    /** Albanian */
    sq = 'sq',
    /** Serbian */
    sr = 'sr',
    /** Southern Sotho */
    st = 'st',
    /** Sundanese */
    su = 'su',
    /** Swedish */
    sv = 'sv',
    /** Swahili */
    sw = 'sw',
    /** Congo Swahili */
    sw_CD = 'sw_CD',
    /** Tamil */
    ta = 'ta',
    /** Telugu */
    te = 'te',
    /** Tajik */
    tg = 'tg',
    /** Thai */
    th = 'th',
    /** Tigrinya */
    ti = 'ti',
    /** Turkmen */
    tk = 'tk',
    /** Tongan */
    to = 'to',
    /** Turkish */
    tr = 'tr',
    /** Tatar */
    tt = 'tt',
    /** Uyghur */
    ug = 'ug',
    /** Ukrainian */
    uk = 'uk',
    /** Urdu */
    ur = 'ur',
    /** Uzbek */
    uz = 'uz',
    /** Vietnamese */
    vi = 'vi',
    /** Volapük */
    vo = 'vo',
    /** Wolof */
    wo = 'wo',
    /** Xhosa */
    xh = 'xh',
    /** Yiddish */
    yi = 'yi',
    /** Yoruba */
    yo = 'yo',
    /** Chinese */
    zh = 'zh',
    /** Simplified Chinese */
    zh_Hans = 'zh_Hans',
    /** Traditional Chinese */
    zh_Hant = 'zh_Hant',
    /** Zulu */
    zu = 'zu',
}

export type LocaleStringCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    length?: Maybe<Scalars['Int']['output']>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    pattern?: Maybe<Scalars['String']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type LocaleTextCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type LocalizedString = {
    languageCode: LanguageCode;
    value: Scalars['String']['output'];
};

export enum LogicalOperator {
    AND = 'AND',
    OR = 'OR',
}

/** Returned when attempting to register or verify a customer account without a password, when one is required. */
export type MissingPasswordError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export type Mutation = {
    /** Adds an item to the Order. If custom fields are defined on the OrderLine entity, a third argument 'customFields' will be available. */
    addItemToOrder: UpdateOrderItemsResult;
    /** Adds mutliple items to the Order. Returns a list of errors for each item that failed to add. It will still add successful items. */
    addItemsToOrder: UpdateMultipleOrderItemsResult;
    /** Add a Payment to the Order */
    addPaymentToOrder: AddPaymentToOrderResult;
    /** Adjusts an OrderLine. If custom fields are defined on the OrderLine entity, a third argument 'customFields' of type `OrderLineCustomFieldsInput` will be available. */
    adjustOrderLine: UpdateOrderItemsResult;
    /** Applies the given coupon code to the active Order */
    applyCouponCode: ApplyCouponCodeResult;
    /** Authenticates the user using a named authentication strategy */
    authenticate: AuthenticationResult;
    /** Create a new Customer Address */
    createCustomerAddress: Address;
    /** Delete an existing Address */
    deleteCustomerAddress: Success;
    /**
     * Authenticates the user using the native authentication strategy. This mutation is an alias for authenticate({ native: { ... }})
     *
     * The `rememberMe` option applies when using cookie-based sessions, and if `true` it will set the maxAge of the session cookie
     * to 1 year.
     */
    login: NativeAuthenticationResult;
    /** End the current authenticated session */
    logout: Success;
    /** Regenerate and send a verification token for a new Customer registration. Only applicable if `authOptions.requireVerification` is set to true. */
    refreshCustomerVerification: RefreshCustomerVerificationResult;
    /**
     * Register a Customer account with the given credentials. There are three possible registration flows:
     *
     * _If `authOptions.requireVerification` is set to `true`:_
     *
     * 1. **The Customer is registered _with_ a password**. A verificationToken will be created (and typically emailed to the Customer). That
     *    verificationToken would then be passed to the `verifyCustomerAccount` mutation _without_ a password. The Customer is then
     *    verified and authenticated in one step.
     * 2. **The Customer is registered _without_ a password**. A verificationToken will be created (and typically emailed to the Customer). That
     *    verificationToken would then be passed to the `verifyCustomerAccount` mutation _with_ the chosen password of the Customer. The Customer is then
     *    verified and authenticated in one step.
     *
     * _If `authOptions.requireVerification` is set to `false`:_
     *
     * 3. The Customer _must_ be registered _with_ a password. No further action is needed - the Customer is able to authenticate immediately.
     */
    registerCustomerAccount: RegisterCustomerAccountResult;
    /** Remove all OrderLine from the Order */
    removeAllOrderLines: RemoveOrderItemsResult;
    /** Removes the given coupon code from the active Order */
    removeCouponCode?: Maybe<Order>;
    /** Remove an OrderLine from the Order */
    removeOrderLine: RemoveOrderItemsResult;
    /** Requests a password reset email to be sent */
    requestPasswordReset?: Maybe<RequestPasswordResetResult>;
    /**
     * Request to update the emailAddress of the active Customer. If `authOptions.requireVerification` is enabled
     * (as is the default), then the `identifierChangeToken` will be assigned to the current User and
     * a IdentifierChangeRequestEvent will be raised. This can then be used e.g. by the EmailPlugin to email
     * that verification token to the Customer, which is then used to verify the change of email address.
     */
    requestUpdateCustomerEmailAddress: RequestUpdateCustomerEmailAddressResult;
    /** Resets a Customer's password based on the provided token */
    resetPassword: ResetPasswordResult;
    setCurrencyCodeForOrder: UpdateOrderItemsResult;
    /** Set the Customer for the Order. Required only if the Customer is not currently logged in */
    setCustomerForOrder: SetCustomerForOrderResult;
    /** Sets the billing address for the active Order */
    setOrderBillingAddress: ActiveOrderResult;
    /** Allows any custom fields to be set for the active Order */
    setOrderCustomFields: ActiveOrderResult;
    /** Sets the shipping address for the active Order */
    setOrderShippingAddress: ActiveOrderResult;
    /**
     * Sets the shipping method by id, which can be obtained with the `eligibleShippingMethods` query.
     * An Order can have multiple shipping methods, in which case you can pass an array of ids. In this case,
     * you should configure a custom ShippingLineAssignmentStrategy in order to know which OrderLines each
     * shipping method will apply to.
     */
    setOrderShippingMethod: SetOrderShippingMethodResult;
    /** Transitions an Order to a new state. Valid next states can be found by querying `nextOrderStates` */
    transitionOrderToState?: Maybe<TransitionOrderToStateResult>;
    /** Unsets the billing address for the active Order. Available since version 3.1.0 */
    unsetOrderBillingAddress: ActiveOrderResult;
    /** Unsets the shipping address for the active Order. Available since version 3.1.0 */
    unsetOrderShippingAddress: ActiveOrderResult;
    /** Update an existing Customer */
    updateCustomer: Customer;
    /** Update an existing Address */
    updateCustomerAddress: Address;
    /**
     * Confirm the update of the emailAddress with the provided token, which has been generated by the
     * `requestUpdateCustomerEmailAddress` mutation.
     */
    updateCustomerEmailAddress: UpdateCustomerEmailAddressResult;
    /** Update the password of the active Customer */
    updateCustomerPassword: UpdateCustomerPasswordResult;
    /**
     * Verify a Customer email address with the token sent to that address. Only applicable if `authOptions.requireVerification` is set to true.
     *
     * If the Customer was not registered with a password in the `registerCustomerAccount` mutation, the password _must_ be
     * provided here.
     */
    verifyCustomerAccount: VerifyCustomerAccountResult;
};

export type MutationAddItemToOrderArgs = {
    productVariantId: Scalars['ID']['input'];
    quantity: Scalars['Int']['input'];
};

export type MutationAddItemsToOrderArgs = {
    inputs: Array<AddItemInput>;
};

export type MutationAddPaymentToOrderArgs = {
    input: PaymentInput;
};

export type MutationAdjustOrderLineArgs = {
    orderLineId: Scalars['ID']['input'];
    quantity: Scalars['Int']['input'];
};

export type MutationApplyCouponCodeArgs = {
    couponCode: Scalars['String']['input'];
};

export type MutationAuthenticateArgs = {
    input: AuthenticationInput;
    rememberMe?: InputMaybe<Scalars['Boolean']['input']>;
};

export type MutationCreateCustomerAddressArgs = {
    input: CreateAddressInput;
};

export type MutationDeleteCustomerAddressArgs = {
    id: Scalars['ID']['input'];
};

export type MutationLoginArgs = {
    password: Scalars['String']['input'];
    rememberMe?: InputMaybe<Scalars['Boolean']['input']>;
    username: Scalars['String']['input'];
};

export type MutationRefreshCustomerVerificationArgs = {
    emailAddress: Scalars['String']['input'];
};

export type MutationRegisterCustomerAccountArgs = {
    input: RegisterCustomerInput;
};

export type MutationRemoveCouponCodeArgs = {
    couponCode: Scalars['String']['input'];
};

export type MutationRemoveOrderLineArgs = {
    orderLineId: Scalars['ID']['input'];
};

export type MutationRequestPasswordResetArgs = {
    emailAddress: Scalars['String']['input'];
};

export type MutationRequestUpdateCustomerEmailAddressArgs = {
    newEmailAddress: Scalars['String']['input'];
    password: Scalars['String']['input'];
};

export type MutationResetPasswordArgs = {
    password: Scalars['String']['input'];
    token: Scalars['String']['input'];
};

export type MutationSetCurrencyCodeForOrderArgs = {
    currencyCode: CurrencyCode;
};

export type MutationSetCustomerForOrderArgs = {
    input: CreateCustomerInput;
};

export type MutationSetOrderBillingAddressArgs = {
    input: CreateAddressInput;
};

export type MutationSetOrderCustomFieldsArgs = {
    input: UpdateOrderInput;
};

export type MutationSetOrderShippingAddressArgs = {
    input: CreateAddressInput;
};

export type MutationSetOrderShippingMethodArgs = {
    shippingMethodId: Array<Scalars['ID']['input']>;
};

export type MutationTransitionOrderToStateArgs = {
    state: Scalars['String']['input'];
};

export type MutationUpdateCustomerArgs = {
    input: UpdateCustomerInput;
};

export type MutationUpdateCustomerAddressArgs = {
    input: UpdateAddressInput;
};

export type MutationUpdateCustomerEmailAddressArgs = {
    token: Scalars['String']['input'];
};

export type MutationUpdateCustomerPasswordArgs = {
    currentPassword: Scalars['String']['input'];
    newPassword: Scalars['String']['input'];
};

export type MutationVerifyCustomerAccountArgs = {
    password?: InputMaybe<Scalars['String']['input']>;
    token: Scalars['String']['input'];
};

export type NativeAuthInput = {
    password: Scalars['String']['input'];
    username: Scalars['String']['input'];
};

/** Returned when attempting an operation that relies on the NativeAuthStrategy, if that strategy is not configured. */
export type NativeAuthStrategyError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export type NativeAuthenticationResult =
    | CurrentUser
    | InvalidCredentialsError
    | NativeAuthStrategyError
    | NotVerifiedError;

/** Returned when attempting to set a negative OrderLine quantity. */
export type NegativeQuantityError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/**
 * Returned when invoking a mutation which depends on there being an active Order on the
 * current session.
 */
export type NoActiveOrderError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export type Node = {
    id: Scalars['ID']['output'];
};

/**
 * Returned if `authOptions.requireVerification` is set to `true` (which is the default)
 * and an unverified user attempts to authenticate.
 */
export type NotVerifiedError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Operators for filtering on a list of Number fields */
export type NumberListOperators = {
    inList: Scalars['Float']['input'];
};

/** Operators for filtering on a Int or Float field */
export type NumberOperators = {
    between?: InputMaybe<NumberRange>;
    eq?: InputMaybe<Scalars['Float']['input']>;
    gt?: InputMaybe<Scalars['Float']['input']>;
    gte?: InputMaybe<Scalars['Float']['input']>;
    isNull?: InputMaybe<Scalars['Boolean']['input']>;
    lt?: InputMaybe<Scalars['Float']['input']>;
    lte?: InputMaybe<Scalars['Float']['input']>;
};

export type NumberRange = {
    end: Scalars['Float']['input'];
    start: Scalars['Float']['input'];
};

export type Order = Node & {
    /** An order is active as long as the payment process has not been completed */
    active: Scalars['Boolean']['output'];
    billingAddress?: Maybe<OrderAddress>;
    /** A unique code for the Order */
    code: Scalars['String']['output'];
    /** An array of all coupon codes applied to the Order */
    couponCodes: Array<Scalars['String']['output']>;
    createdAt: Scalars['DateTime']['output'];
    currencyCode: CurrencyCode;
    customFields?: Maybe<Scalars['JSON']['output']>;
    customer?: Maybe<Customer>;
    discounts: Array<Discount>;
    fulfillments?: Maybe<Array<Fulfillment>>;
    history: HistoryEntryList;
    id: Scalars['ID']['output'];
    lines: Array<OrderLine>;
    /**
     * The date & time that the Order was placed, i.e. the Customer
     * completed the checkout and the Order is no longer "active"
     */
    orderPlacedAt?: Maybe<Scalars['DateTime']['output']>;
    payments?: Maybe<Array<Payment>>;
    /** Promotions applied to the order. Only gets populated after the payment process has completed. */
    promotions: Array<Promotion>;
    shipping: Scalars['Money']['output'];
    shippingAddress?: Maybe<OrderAddress>;
    shippingLines: Array<ShippingLine>;
    shippingWithTax: Scalars['Money']['output'];
    state: Scalars['String']['output'];
    /**
     * The subTotal is the total of all OrderLines in the Order. This figure also includes any Order-level
     * discounts which have been prorated (proportionally distributed) amongst the items of each OrderLine.
     * To get a total of all OrderLines which does not account for prorated discounts, use the
     * sum of `OrderLine.discountedLinePrice` values.
     */
    subTotal: Scalars['Money']['output'];
    /** Same as subTotal, but inclusive of tax */
    subTotalWithTax: Scalars['Money']['output'];
    /**
     * Surcharges are arbitrary modifications to the Order total which are neither
     * ProductVariants nor discounts resulting from applied Promotions. For example,
     * one-off discounts based on customer interaction, or surcharges based on payment
     * methods.
     */
    surcharges: Array<Surcharge>;
    /** A summary of the taxes being applied to this Order */
    taxSummary: Array<OrderTaxSummary>;
    /** Equal to subTotal plus shipping */
    total: Scalars['Money']['output'];
    totalQuantity: Scalars['Int']['output'];
    /** The final payable amount. Equal to subTotalWithTax plus shippingWithTax */
    totalWithTax: Scalars['Money']['output'];
    type: OrderType;
    updatedAt: Scalars['DateTime']['output'];
};

export type OrderHistoryArgs = {
    options?: InputMaybe<HistoryEntryListOptions>;
};

export type OrderAddress = {
    city?: Maybe<Scalars['String']['output']>;
    company?: Maybe<Scalars['String']['output']>;
    country?: Maybe<Scalars['String']['output']>;
    countryCode?: Maybe<Scalars['String']['output']>;
    customFields?: Maybe<Scalars['JSON']['output']>;
    fullName?: Maybe<Scalars['String']['output']>;
    phoneNumber?: Maybe<Scalars['String']['output']>;
    postalCode?: Maybe<Scalars['String']['output']>;
    province?: Maybe<Scalars['String']['output']>;
    streetLine1?: Maybe<Scalars['String']['output']>;
    streetLine2?: Maybe<Scalars['String']['output']>;
};

export type OrderFilterParameter = {
    _and?: InputMaybe<Array<OrderFilterParameter>>;
    _or?: InputMaybe<Array<OrderFilterParameter>>;
    active?: InputMaybe<BooleanOperators>;
    code?: InputMaybe<StringOperators>;
    createdAt?: InputMaybe<DateOperators>;
    currencyCode?: InputMaybe<StringOperators>;
    id?: InputMaybe<IdOperators>;
    orderPlacedAt?: InputMaybe<DateOperators>;
    shipping?: InputMaybe<NumberOperators>;
    shippingWithTax?: InputMaybe<NumberOperators>;
    state?: InputMaybe<StringOperators>;
    subTotal?: InputMaybe<NumberOperators>;
    subTotalWithTax?: InputMaybe<NumberOperators>;
    total?: InputMaybe<NumberOperators>;
    totalQuantity?: InputMaybe<NumberOperators>;
    totalWithTax?: InputMaybe<NumberOperators>;
    type?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

/** Returned when an order operation is rejected by an OrderInterceptor method. */
export type OrderInterceptorError = ErrorResult & {
    errorCode: ErrorCode;
    interceptorError: Scalars['String']['output'];
    message: Scalars['String']['output'];
};

/** Returned when the maximum order size limit has been reached. */
export type OrderLimitError = ErrorResult & {
    errorCode: ErrorCode;
    maxItems: Scalars['Int']['output'];
    message: Scalars['String']['output'];
};

export type OrderLine = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    /** The price of the line including discounts, excluding tax */
    discountedLinePrice: Scalars['Money']['output'];
    /** The price of the line including discounts and tax */
    discountedLinePriceWithTax: Scalars['Money']['output'];
    /**
     * The price of a single unit including discounts, excluding tax.
     *
     * If Order-level discounts have been applied, this will not be the
     * actual taxable unit price (see `proratedUnitPrice`), but is generally the
     * correct price to display to customers to avoid confusion
     * about the internal handling of distributed Order-level discounts.
     */
    discountedUnitPrice: Scalars['Money']['output'];
    /** The price of a single unit including discounts and tax */
    discountedUnitPriceWithTax: Scalars['Money']['output'];
    discounts: Array<Discount>;
    featuredAsset?: Maybe<Asset>;
    fulfillmentLines?: Maybe<Array<FulfillmentLine>>;
    id: Scalars['ID']['output'];
    /** The total price of the line excluding tax and discounts. */
    linePrice: Scalars['Money']['output'];
    /** The total price of the line including tax but excluding discounts. */
    linePriceWithTax: Scalars['Money']['output'];
    /** The total tax on this line */
    lineTax: Scalars['Money']['output'];
    order: Order;
    /** The quantity at the time the Order was placed */
    orderPlacedQuantity: Scalars['Int']['output'];
    productVariant: ProductVariant;
    /**
     * The actual line price, taking into account both item discounts _and_ prorated (proportionally-distributed)
     * Order-level discounts. This value is the true economic value of the OrderLine, and is used in tax
     * and refund calculations.
     */
    proratedLinePrice: Scalars['Money']['output'];
    /** The proratedLinePrice including tax */
    proratedLinePriceWithTax: Scalars['Money']['output'];
    /**
     * The actual unit price, taking into account both item discounts _and_ prorated (proportionally-distributed)
     * Order-level discounts. This value is the true economic value of the OrderItem, and is used in tax
     * and refund calculations.
     */
    proratedUnitPrice: Scalars['Money']['output'];
    /** The proratedUnitPrice including tax */
    proratedUnitPriceWithTax: Scalars['Money']['output'];
    /** The quantity of items purchased */
    quantity: Scalars['Int']['output'];
    taxLines: Array<TaxLine>;
    taxRate: Scalars['Float']['output'];
    /** The price of a single unit, excluding tax and discounts */
    unitPrice: Scalars['Money']['output'];
    /** Non-zero if the unitPrice has changed since it was initially added to Order */
    unitPriceChangeSinceAdded: Scalars['Money']['output'];
    /** The price of a single unit, including tax but excluding discounts */
    unitPriceWithTax: Scalars['Money']['output'];
    /** Non-zero if the unitPriceWithTax has changed since it was initially added to Order */
    unitPriceWithTaxChangeSinceAdded: Scalars['Money']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type OrderList = PaginatedList & {
    items: Array<Order>;
    totalItems: Scalars['Int']['output'];
};

export type OrderListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<OrderFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<OrderSortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
};

/** Returned when attempting to modify the contents of an Order that is not in the `AddingItems` state. */
export type OrderModificationError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Returned when attempting to add a Payment to an Order that is not in the `ArrangingPayment` state. */
export type OrderPaymentStateError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export type OrderSortParameter = {
    code?: InputMaybe<SortOrder>;
    createdAt?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    orderPlacedAt?: InputMaybe<SortOrder>;
    shipping?: InputMaybe<SortOrder>;
    shippingWithTax?: InputMaybe<SortOrder>;
    state?: InputMaybe<SortOrder>;
    subTotal?: InputMaybe<SortOrder>;
    subTotalWithTax?: InputMaybe<SortOrder>;
    total?: InputMaybe<SortOrder>;
    totalQuantity?: InputMaybe<SortOrder>;
    totalWithTax?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

/** Returned if there is an error in transitioning the Order state */
export type OrderStateTransitionError = ErrorResult & {
    errorCode: ErrorCode;
    fromState: Scalars['String']['output'];
    message: Scalars['String']['output'];
    toState: Scalars['String']['output'];
    transitionError: Scalars['String']['output'];
};

/**
 * A summary of the taxes being applied to this order, grouped
 * by taxRate.
 */
export type OrderTaxSummary = {
    /** A description of this tax */
    description: Scalars['String']['output'];
    /** The total net price of OrderLines to which this taxRate applies */
    taxBase: Scalars['Money']['output'];
    /** The taxRate as a percentage */
    taxRate: Scalars['Float']['output'];
    /** The total tax being applied to the Order at this taxRate */
    taxTotal: Scalars['Money']['output'];
};

export enum OrderType {
    Aggregate = 'Aggregate',
    Regular = 'Regular',
    Seller = 'Seller',
}

export type PaginatedList = {
    items: Array<Node>;
    totalItems: Scalars['Int']['output'];
};

/** Returned when attempting to verify a customer account with a password, when a password has already been set. */
export type PasswordAlreadySetError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/**
 * Returned if the token used to reset a Customer's password is valid, but has
 * expired according to the `verificationTokenDuration` setting in the AuthOptions.
 */
export type PasswordResetTokenExpiredError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/**
 * Returned if the token used to reset a Customer's password is either
 * invalid or does not match any expected tokens.
 */
export type PasswordResetTokenInvalidError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/** Returned when attempting to register or verify a customer account where the given password fails password validation. */
export type PasswordValidationError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
    validationErrorMessage: Scalars['String']['output'];
};

export type Payment = Node & {
    amount: Scalars['Money']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    errorMessage?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    metadata?: Maybe<Scalars['JSON']['output']>;
    method: Scalars['String']['output'];
    refunds: Array<Refund>;
    state: Scalars['String']['output'];
    transactionId?: Maybe<Scalars['String']['output']>;
    updatedAt: Scalars['DateTime']['output'];
};

/** Returned when a Payment is declined by the payment provider. */
export type PaymentDeclinedError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
    paymentErrorMessage: Scalars['String']['output'];
};

/** Returned when a Payment fails due to an error. */
export type PaymentFailedError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
    paymentErrorMessage: Scalars['String']['output'];
};

/** Passed as input to the `addPaymentToOrder` mutation. */
export type PaymentInput = {
    /**
     * This field should contain arbitrary data passed to the specified PaymentMethodHandler's `createPayment()` method
     * as the "metadata" argument. For example, it could contain an ID for the payment and other
     * data generated by the payment provider.
     */
    metadata: Scalars['JSON']['input'];
    /** This field should correspond to the `code` property of a PaymentMethod. */
    method: Scalars['String']['input'];
};

export type PaymentMethod = Node & {
    checker?: Maybe<ConfigurableOperation>;
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    enabled: Scalars['Boolean']['output'];
    handler: ConfigurableOperation;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    translations: Array<PaymentMethodTranslation>;
    updatedAt: Scalars['DateTime']['output'];
};

export type PaymentMethodQuote = {
    code: Scalars['String']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    eligibilityMessage?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    isEligible: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
};

export type PaymentMethodTranslation = {
    createdAt: Scalars['DateTime']['output'];
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

/**
 * @description
 * Permissions for administrators and customers. Used to control access to
 * GraphQL resolvers via the {@link Allow} decorator.
 *
 * ## Understanding Permission.Owner
 *
 * `Permission.Owner` is a special permission which is used in some Vendure resolvers to indicate that that resolver should only
 * be accessible to the "owner" of that resource.
 *
 * For example, the Shop API `activeCustomer` query resolver should only return the Customer object for the "owner" of that Customer, i.e.
 * based on the activeUserId of the current session. As a result, the resolver code looks like this:
 *
 * @example
 * ```TypeScript
 * \@Query()
 * \@Allow(Permission.Owner)
 * async activeCustomer(\@Ctx() ctx: RequestContext): Promise<Customer | undefined> {
 *   const userId = ctx.activeUserId;
 *   if (userId) {
 *     return this.customerService.findOneByUserId(ctx, userId);
 *   }
 * }
 * ```
 *
 * Here we can see that the "ownership" must be enforced by custom logic inside the resolver. Since "ownership" cannot be defined generally
 * nor statically encoded at build-time, any resolvers using `Permission.Owner` **must** include logic to enforce that only the owner
 * of the resource has access. If not, then it is the equivalent of using `Permission.Public`.
 *
 *
 * @docsCategory common
 */
export enum Permission {
    /** Authenticated means simply that the user is logged in */
    Authenticated = 'Authenticated',
    /** Grants permission to create Administrator */
    CreateAdministrator = 'CreateAdministrator',
    /** Grants permission to create Asset */
    CreateAsset = 'CreateAsset',
    /** Grants permission to create Products, Facets, Assets, Collections */
    CreateCatalog = 'CreateCatalog',
    /** Grants permission to create Channel */
    CreateChannel = 'CreateChannel',
    /** Grants permission to create Collection */
    CreateCollection = 'CreateCollection',
    /** Grants permission to create Country */
    CreateCountry = 'CreateCountry',
    /** Grants permission to create Customer */
    CreateCustomer = 'CreateCustomer',
    /** Grants permission to create CustomerGroup */
    CreateCustomerGroup = 'CreateCustomerGroup',
    /** Grants permission to create Facet */
    CreateFacet = 'CreateFacet',
    /** Grants permission to create Order */
    CreateOrder = 'CreateOrder',
    /** Grants permission to create PaymentMethod */
    CreatePaymentMethod = 'CreatePaymentMethod',
    /** Grants permission to create Product */
    CreateProduct = 'CreateProduct',
    /** Grants permission to create Promotion */
    CreatePromotion = 'CreatePromotion',
    /** Grants permission to create Seller */
    CreateSeller = 'CreateSeller',
    /** Grants permission to create PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
    CreateSettings = 'CreateSettings',
    /** Grants permission to create ShippingMethod */
    CreateShippingMethod = 'CreateShippingMethod',
    /** Grants permission to create StockLocation */
    CreateStockLocation = 'CreateStockLocation',
    /** Grants permission to create System */
    CreateSystem = 'CreateSystem',
    /** Grants permission to create Tag */
    CreateTag = 'CreateTag',
    /** Grants permission to create TaxCategory */
    CreateTaxCategory = 'CreateTaxCategory',
    /** Grants permission to create TaxRate */
    CreateTaxRate = 'CreateTaxRate',
    /** Grants permission to create Zone */
    CreateZone = 'CreateZone',
    /** Grants permission to delete Administrator */
    DeleteAdministrator = 'DeleteAdministrator',
    /** Grants permission to delete Asset */
    DeleteAsset = 'DeleteAsset',
    /** Grants permission to delete Products, Facets, Assets, Collections */
    DeleteCatalog = 'DeleteCatalog',
    /** Grants permission to delete Channel */
    DeleteChannel = 'DeleteChannel',
    /** Grants permission to delete Collection */
    DeleteCollection = 'DeleteCollection',
    /** Grants permission to delete Country */
    DeleteCountry = 'DeleteCountry',
    /** Grants permission to delete Customer */
    DeleteCustomer = 'DeleteCustomer',
    /** Grants permission to delete CustomerGroup */
    DeleteCustomerGroup = 'DeleteCustomerGroup',
    /** Grants permission to delete Facet */
    DeleteFacet = 'DeleteFacet',
    /** Grants permission to delete Order */
    DeleteOrder = 'DeleteOrder',
    /** Grants permission to delete PaymentMethod */
    DeletePaymentMethod = 'DeletePaymentMethod',
    /** Grants permission to delete Product */
    DeleteProduct = 'DeleteProduct',
    /** Grants permission to delete Promotion */
    DeletePromotion = 'DeletePromotion',
    /** Grants permission to delete Seller */
    DeleteSeller = 'DeleteSeller',
    /** Grants permission to delete PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
    DeleteSettings = 'DeleteSettings',
    /** Grants permission to delete ShippingMethod */
    DeleteShippingMethod = 'DeleteShippingMethod',
    /** Grants permission to delete StockLocation */
    DeleteStockLocation = 'DeleteStockLocation',
    /** Grants permission to delete System */
    DeleteSystem = 'DeleteSystem',
    /** Grants permission to delete Tag */
    DeleteTag = 'DeleteTag',
    /** Grants permission to delete TaxCategory */
    DeleteTaxCategory = 'DeleteTaxCategory',
    /** Grants permission to delete TaxRate */
    DeleteTaxRate = 'DeleteTaxRate',
    /** Grants permission to delete Zone */
    DeleteZone = 'DeleteZone',
    /** Owner means the user owns this entity, e.g. a Customer's own Order */
    Owner = 'Owner',
    /** Public means any unauthenticated user may perform the operation */
    Public = 'Public',
    /** Grants permission to read Administrator */
    ReadAdministrator = 'ReadAdministrator',
    /** Grants permission to read Asset */
    ReadAsset = 'ReadAsset',
    /** Grants permission to read Products, Facets, Assets, Collections */
    ReadCatalog = 'ReadCatalog',
    /** Grants permission to read Channel */
    ReadChannel = 'ReadChannel',
    /** Grants permission to read Collection */
    ReadCollection = 'ReadCollection',
    /** Grants permission to read Country */
    ReadCountry = 'ReadCountry',
    /** Grants permission to read Customer */
    ReadCustomer = 'ReadCustomer',
    /** Grants permission to read CustomerGroup */
    ReadCustomerGroup = 'ReadCustomerGroup',
    /** Grants permission to read Facet */
    ReadFacet = 'ReadFacet',
    /** Grants permission to read Order */
    ReadOrder = 'ReadOrder',
    /** Grants permission to read PaymentMethod */
    ReadPaymentMethod = 'ReadPaymentMethod',
    /** Grants permission to read Product */
    ReadProduct = 'ReadProduct',
    /** Grants permission to read Promotion */
    ReadPromotion = 'ReadPromotion',
    /** Grants permission to read Seller */
    ReadSeller = 'ReadSeller',
    /** Grants permission to read PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
    ReadSettings = 'ReadSettings',
    /** Grants permission to read ShippingMethod */
    ReadShippingMethod = 'ReadShippingMethod',
    /** Grants permission to read StockLocation */
    ReadStockLocation = 'ReadStockLocation',
    /** Grants permission to read System */
    ReadSystem = 'ReadSystem',
    /** Grants permission to read Tag */
    ReadTag = 'ReadTag',
    /** Grants permission to read TaxCategory */
    ReadTaxCategory = 'ReadTaxCategory',
    /** Grants permission to read TaxRate */
    ReadTaxRate = 'ReadTaxRate',
    /** Grants permission to read Zone */
    ReadZone = 'ReadZone',
    /** SuperAdmin has unrestricted access to all operations */
    SuperAdmin = 'SuperAdmin',
    /** Grants permission to update Administrator */
    UpdateAdministrator = 'UpdateAdministrator',
    /** Grants permission to update Asset */
    UpdateAsset = 'UpdateAsset',
    /** Grants permission to update Products, Facets, Assets, Collections */
    UpdateCatalog = 'UpdateCatalog',
    /** Grants permission to update Channel */
    UpdateChannel = 'UpdateChannel',
    /** Grants permission to update Collection */
    UpdateCollection = 'UpdateCollection',
    /** Grants permission to update Country */
    UpdateCountry = 'UpdateCountry',
    /** Grants permission to update Customer */
    UpdateCustomer = 'UpdateCustomer',
    /** Grants permission to update CustomerGroup */
    UpdateCustomerGroup = 'UpdateCustomerGroup',
    /** Grants permission to update Facet */
    UpdateFacet = 'UpdateFacet',
    /** Grants permission to update GlobalSettings */
    UpdateGlobalSettings = 'UpdateGlobalSettings',
    /** Grants permission to update Order */
    UpdateOrder = 'UpdateOrder',
    /** Grants permission to update PaymentMethod */
    UpdatePaymentMethod = 'UpdatePaymentMethod',
    /** Grants permission to update Product */
    UpdateProduct = 'UpdateProduct',
    /** Grants permission to update Promotion */
    UpdatePromotion = 'UpdatePromotion',
    /** Grants permission to update Seller */
    UpdateSeller = 'UpdateSeller',
    /** Grants permission to update PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
    UpdateSettings = 'UpdateSettings',
    /** Grants permission to update ShippingMethod */
    UpdateShippingMethod = 'UpdateShippingMethod',
    /** Grants permission to update StockLocation */
    UpdateStockLocation = 'UpdateStockLocation',
    /** Grants permission to update System */
    UpdateSystem = 'UpdateSystem',
    /** Grants permission to update Tag */
    UpdateTag = 'UpdateTag',
    /** Grants permission to update TaxCategory */
    UpdateTaxCategory = 'UpdateTaxCategory',
    /** Grants permission to update TaxRate */
    UpdateTaxRate = 'UpdateTaxRate',
    /** Grants permission to update Zone */
    UpdateZone = 'UpdateZone',
}

/** The price range where the result has more than one price */
export type PriceRange = {
    max: Scalars['Money']['output'];
    min: Scalars['Money']['output'];
};

export type Product = Node & {
    assets: Array<Asset>;
    collections: Array<Collection>;
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    enabled: Scalars['Boolean']['output'];
    facetValues: Array<FacetValue>;
    featuredAsset?: Maybe<Asset>;
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    optionGroups: Array<ProductOptionGroup>;
    slug: Scalars['String']['output'];
    translations: Array<ProductTranslation>;
    updatedAt: Scalars['DateTime']['output'];
    /** Returns a paginated, sortable, filterable list of ProductVariants */
    variantList: ProductVariantList;
    /** Returns all ProductVariants */
    variants: Array<ProductVariant>;
};

export type ProductVariantListArgs = {
    options?: InputMaybe<ProductVariantListOptions>;
};

export type ProductFilterParameter = {
    _and?: InputMaybe<Array<ProductFilterParameter>>;
    _or?: InputMaybe<Array<ProductFilterParameter>>;
    createdAt?: InputMaybe<DateOperators>;
    description?: InputMaybe<StringOperators>;
    enabled?: InputMaybe<BooleanOperators>;
    id?: InputMaybe<IdOperators>;
    languageCode?: InputMaybe<StringOperators>;
    name?: InputMaybe<StringOperators>;
    slug?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

export type ProductList = PaginatedList & {
    items: Array<Product>;
    totalItems: Scalars['Int']['output'];
};

export type ProductListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<ProductFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<ProductSortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductOption = Node & {
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    group: ProductOptionGroup;
    groupId: Scalars['ID']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    translations: Array<ProductOptionTranslation>;
    updatedAt: Scalars['DateTime']['output'];
};

export type ProductOptionGroup = Node & {
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    options: Array<ProductOption>;
    translations: Array<ProductOptionGroupTranslation>;
    updatedAt: Scalars['DateTime']['output'];
};

export type ProductOptionGroupTranslation = {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type ProductOptionTranslation = {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type ProductSortParameter = {
    createdAt?: InputMaybe<SortOrder>;
    description?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    name?: InputMaybe<SortOrder>;
    slug?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

export type ProductTranslation = {
    createdAt: Scalars['DateTime']['output'];
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    slug: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type ProductVariant = Node & {
    assets: Array<Asset>;
    createdAt: Scalars['DateTime']['output'];
    currencyCode: CurrencyCode;
    customFields?: Maybe<Scalars['JSON']['output']>;
    facetValues: Array<FacetValue>;
    featuredAsset?: Maybe<Asset>;
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    options: Array<ProductOption>;
    price: Scalars['Money']['output'];
    priceWithTax: Scalars['Money']['output'];
    product: Product;
    productId: Scalars['ID']['output'];
    sku: Scalars['String']['output'];
    stockLevel: Scalars['String']['output'];
    taxCategory: TaxCategory;
    taxRateApplied: TaxRate;
    translations: Array<ProductVariantTranslation>;
    updatedAt: Scalars['DateTime']['output'];
};

export type ProductVariantFilterParameter = {
    _and?: InputMaybe<Array<ProductVariantFilterParameter>>;
    _or?: InputMaybe<Array<ProductVariantFilterParameter>>;
    createdAt?: InputMaybe<DateOperators>;
    currencyCode?: InputMaybe<StringOperators>;
    id?: InputMaybe<IdOperators>;
    languageCode?: InputMaybe<StringOperators>;
    name?: InputMaybe<StringOperators>;
    price?: InputMaybe<NumberOperators>;
    priceWithTax?: InputMaybe<NumberOperators>;
    productId?: InputMaybe<IdOperators>;
    sku?: InputMaybe<StringOperators>;
    stockLevel?: InputMaybe<StringOperators>;
    updatedAt?: InputMaybe<DateOperators>;
};

export type ProductVariantList = PaginatedList & {
    items: Array<ProductVariant>;
    totalItems: Scalars['Int']['output'];
};

export type ProductVariantListOptions = {
    /** Allows the results to be filtered */
    filter?: InputMaybe<ProductVariantFilterParameter>;
    /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
    filterOperator?: InputMaybe<LogicalOperator>;
    /** Skips the first n results, for use in pagination */
    skip?: InputMaybe<Scalars['Int']['input']>;
    /** Specifies which properties to sort the results by */
    sort?: InputMaybe<ProductVariantSortParameter>;
    /** Takes n results, for use in pagination */
    take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductVariantSortParameter = {
    createdAt?: InputMaybe<SortOrder>;
    id?: InputMaybe<SortOrder>;
    name?: InputMaybe<SortOrder>;
    price?: InputMaybe<SortOrder>;
    priceWithTax?: InputMaybe<SortOrder>;
    productId?: InputMaybe<SortOrder>;
    sku?: InputMaybe<SortOrder>;
    stockLevel?: InputMaybe<SortOrder>;
    updatedAt?: InputMaybe<SortOrder>;
};

export type ProductVariantTranslation = {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type Promotion = Node & {
    actions: Array<ConfigurableOperation>;
    conditions: Array<ConfigurableOperation>;
    couponCode?: Maybe<Scalars['String']['output']>;
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    enabled: Scalars['Boolean']['output'];
    endsAt?: Maybe<Scalars['DateTime']['output']>;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    perCustomerUsageLimit?: Maybe<Scalars['Int']['output']>;
    startsAt?: Maybe<Scalars['DateTime']['output']>;
    translations: Array<PromotionTranslation>;
    updatedAt: Scalars['DateTime']['output'];
    usageLimit?: Maybe<Scalars['Int']['output']>;
};

export type PromotionList = PaginatedList & {
    items: Array<Promotion>;
    totalItems: Scalars['Int']['output'];
};

export type PromotionTranslation = {
    createdAt: Scalars['DateTime']['output'];
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type Province = Node &
    Region & {
        code: Scalars['String']['output'];
        createdAt: Scalars['DateTime']['output'];
        customFields?: Maybe<Scalars['JSON']['output']>;
        enabled: Scalars['Boolean']['output'];
        id: Scalars['ID']['output'];
        languageCode: LanguageCode;
        name: Scalars['String']['output'];
        parent?: Maybe<Region>;
        parentId?: Maybe<Scalars['ID']['output']>;
        translations: Array<RegionTranslation>;
        type: Scalars['String']['output'];
        updatedAt: Scalars['DateTime']['output'];
    };

export type ProvinceList = PaginatedList & {
    items: Array<Province>;
    totalItems: Scalars['Int']['output'];
};

export type PublicPaymentMethod = {
    code: Scalars['String']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    translations: Array<PaymentMethodTranslation>;
};

export type PublicShippingMethod = {
    code: Scalars['String']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    translations: Array<ShippingMethodTranslation>;
};

export type Query = {
    /** The active Channel */
    activeChannel: Channel;
    /** The active Customer */
    activeCustomer?: Maybe<Customer>;
    /**
     * The active Order. Will be `null` until an Order is created via `addItemToOrder`. Once an Order reaches the
     * state of `PaymentAuthorized` or `PaymentSettled`, then that Order is no longer considered "active" and this
     * query will once again return `null`.
     */
    activeOrder?: Maybe<Order>;
    /** Get active payment methods */
    activePaymentMethods: Array<Maybe<PublicPaymentMethod>>;
    /** Get active shipping methods */
    activeShippingMethods: Array<Maybe<PublicShippingMethod>>;
    /** An array of supported Countries */
    availableCountries: Array<Country>;
    /** Returns a Collection either by its id or slug. If neither 'id' nor 'slug' is specified, an error will result. */
    collection?: Maybe<Collection>;
    /** A list of Collections available to the shop */
    collections: CollectionList;
    /** Returns a list of payment methods and their eligibility based on the current active Order */
    eligiblePaymentMethods: Array<PaymentMethodQuote>;
    /** Returns a list of eligible shipping methods based on the current active Order */
    eligibleShippingMethods: Array<ShippingMethodQuote>;
    /** Returns a Facet by its id */
    facet?: Maybe<Facet>;
    /** A list of Facets available to the shop */
    facets: FacetList;
    /** Returns information about the current authenticated User */
    me?: Maybe<CurrentUser>;
    /** Returns the possible next states that the activeOrder can transition to */
    nextOrderStates: Array<Scalars['String']['output']>;
    /**
     * Returns an Order based on the id. Note that in the Shop API, only orders belonging to the
     * currently-authenticated User may be queried.
     */
    order?: Maybe<Order>;
    /**
     * Returns an Order based on the order `code`. For guest Orders (i.e. Orders placed by non-authenticated Customers)
     * this query will only return the Order within 2 hours of the Order being placed. This allows an Order confirmation
     * screen to be shown immediately after completion of a guest checkout, yet prevents security risks of allowing
     * general anonymous access to Order data.
     */
    orderByCode?: Maybe<Order>;
    /** Get a Product either by id or slug. If neither 'id' nor 'slug' is specified, an error will result. */
    product?: Maybe<Product>;
    /** Get a list of Products */
    products: ProductList;
    /** Search Products based on the criteria set by the `SearchInput` */
    search: SearchResponse;
};

export type QueryCollectionArgs = {
    id?: InputMaybe<Scalars['ID']['input']>;
    slug?: InputMaybe<Scalars['String']['input']>;
};

export type QueryCollectionsArgs = {
    options?: InputMaybe<CollectionListOptions>;
};

export type QueryFacetArgs = {
    id: Scalars['ID']['input'];
};

export type QueryFacetsArgs = {
    options?: InputMaybe<FacetListOptions>;
};

export type QueryOrderArgs = {
    id: Scalars['ID']['input'];
};

export type QueryOrderByCodeArgs = {
    code: Scalars['String']['input'];
};

export type QueryProductArgs = {
    id?: InputMaybe<Scalars['ID']['input']>;
    slug?: InputMaybe<Scalars['String']['input']>;
};

export type QueryProductsArgs = {
    options?: InputMaybe<ProductListOptions>;
};

export type QuerySearchArgs = {
    input: SearchInput;
};

export type RefreshCustomerVerificationResult = NativeAuthStrategyError | Success;

export type Refund = Node & {
    adjustment: Scalars['Money']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    items: Scalars['Money']['output'];
    lines: Array<RefundLine>;
    metadata?: Maybe<Scalars['JSON']['output']>;
    method?: Maybe<Scalars['String']['output']>;
    paymentId: Scalars['ID']['output'];
    reason?: Maybe<Scalars['String']['output']>;
    shipping: Scalars['Money']['output'];
    state: Scalars['String']['output'];
    total: Scalars['Money']['output'];
    transactionId?: Maybe<Scalars['String']['output']>;
    updatedAt: Scalars['DateTime']['output'];
};

export type RefundLine = {
    orderLine: OrderLine;
    orderLineId: Scalars['ID']['output'];
    quantity: Scalars['Int']['output'];
    refund: Refund;
    refundId: Scalars['ID']['output'];
};

export type Region = {
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    enabled: Scalars['Boolean']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    parent?: Maybe<Region>;
    parentId?: Maybe<Scalars['ID']['output']>;
    translations: Array<RegionTranslation>;
    type: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type RegionTranslation = {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type RegisterCustomerAccountResult =
    | MissingPasswordError
    | NativeAuthStrategyError
    | PasswordValidationError
    | Success;

export type RegisterCustomerInput = {
    emailAddress: Scalars['String']['input'];
    firstName?: InputMaybe<Scalars['String']['input']>;
    lastName?: InputMaybe<Scalars['String']['input']>;
    password?: InputMaybe<Scalars['String']['input']>;
    phoneNumber?: InputMaybe<Scalars['String']['input']>;
    title?: InputMaybe<Scalars['String']['input']>;
};

export type RelationCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    entity: Scalars['String']['output'];
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    scalarFields: Array<Scalars['String']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type RemoveOrderItemsResult = Order | OrderInterceptorError | OrderModificationError;

export type RequestPasswordResetResult = NativeAuthStrategyError | Success;

export type RequestUpdateCustomerEmailAddressResult =
    | EmailAddressConflictError
    | InvalidCredentialsError
    | NativeAuthStrategyError
    | Success;

export type ResetPasswordResult =
    | CurrentUser
    | NativeAuthStrategyError
    | NotVerifiedError
    | PasswordResetTokenExpiredError
    | PasswordResetTokenInvalidError
    | PasswordValidationError;

export type Role = Node & {
    channels: Array<Channel>;
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    permissions: Array<Permission>;
    updatedAt: Scalars['DateTime']['output'];
};

export type RoleList = PaginatedList & {
    items: Array<Role>;
    totalItems: Scalars['Int']['output'];
};

export type SearchInput = {
    collectionId?: InputMaybe<Scalars['ID']['input']>;
    collectionSlug?: InputMaybe<Scalars['String']['input']>;
    facetValueFilters?: InputMaybe<Array<FacetValueFilterInput>>;
    /** @deprecated Use `facetValueFilters` instead */
    facetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    /** @deprecated Use `facetValueFilters` instead */
    facetValueOperator?: InputMaybe<LogicalOperator>;
    groupByProduct?: InputMaybe<Scalars['Boolean']['input']>;
    skip?: InputMaybe<Scalars['Int']['input']>;
    sort?: InputMaybe<SearchResultSortParameter>;
    take?: InputMaybe<Scalars['Int']['input']>;
    term?: InputMaybe<Scalars['String']['input']>;
};

export type SearchReindexResponse = {
    success: Scalars['Boolean']['output'];
};

export type SearchResponse = {
    collections: Array<CollectionResult>;
    facetValues: Array<FacetValueResult>;
    items: Array<SearchResult>;
    totalItems: Scalars['Int']['output'];
};

export type SearchResult = {
    /** An array of ids of the Collections in which this result appears */
    collectionIds: Array<Scalars['ID']['output']>;
    currencyCode: CurrencyCode;
    description: Scalars['String']['output'];
    facetIds: Array<Scalars['ID']['output']>;
    facetValueIds: Array<Scalars['ID']['output']>;
    price: SearchResultPrice;
    priceWithTax: SearchResultPrice;
    productAsset?: Maybe<SearchResultAsset>;
    productId: Scalars['ID']['output'];
    productName: Scalars['String']['output'];
    productVariantAsset?: Maybe<SearchResultAsset>;
    productVariantId: Scalars['ID']['output'];
    productVariantName: Scalars['String']['output'];
    /** A relevance score for the result. Differs between database implementations */
    score: Scalars['Float']['output'];
    sku: Scalars['String']['output'];
    slug: Scalars['String']['output'];
};

export type SearchResultAsset = {
    focalPoint?: Maybe<Coordinate>;
    id: Scalars['ID']['output'];
    preview: Scalars['String']['output'];
};

/** The price of a search result product, either as a range or as a single price */
export type SearchResultPrice = PriceRange | SinglePrice;

export type SearchResultSortParameter = {
    name?: InputMaybe<SortOrder>;
    price?: InputMaybe<SortOrder>;
};

export type Seller = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type SetCustomerForOrderResult =
    | AlreadyLoggedInError
    | EmailAddressConflictError
    | GuestCheckoutError
    | NoActiveOrderError
    | Order;

export type SetOrderShippingMethodResult =
    | IneligibleShippingMethodError
    | NoActiveOrderError
    | Order
    | OrderModificationError;

export type ShippingLine = {
    customFields?: Maybe<Scalars['JSON']['output']>;
    discountedPrice: Scalars['Money']['output'];
    discountedPriceWithTax: Scalars['Money']['output'];
    discounts: Array<Discount>;
    id: Scalars['ID']['output'];
    price: Scalars['Money']['output'];
    priceWithTax: Scalars['Money']['output'];
    shippingMethod: ShippingMethod;
};

export type ShippingMethod = Node & {
    calculator: ConfigurableOperation;
    checker: ConfigurableOperation;
    code: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    fulfillmentHandlerCode: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    translations: Array<ShippingMethodTranslation>;
    updatedAt: Scalars['DateTime']['output'];
};

export type ShippingMethodList = PaginatedList & {
    items: Array<ShippingMethod>;
    totalItems: Scalars['Int']['output'];
};

export type ShippingMethodQuote = {
    code: Scalars['String']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    /** Any optional metadata returned by the ShippingCalculator in the ShippingCalculationResult */
    metadata?: Maybe<Scalars['JSON']['output']>;
    name: Scalars['String']['output'];
    price: Scalars['Money']['output'];
    priceWithTax: Scalars['Money']['output'];
};

export type ShippingMethodTranslation = {
    createdAt: Scalars['DateTime']['output'];
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    languageCode: LanguageCode;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

/** The price value where the result has a single price */
export type SinglePrice = {
    value: Scalars['Money']['output'];
};

export enum SortOrder {
    ASC = 'ASC',
    DESC = 'DESC',
}

export type StringCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    length?: Maybe<Scalars['Int']['output']>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    options?: Maybe<Array<StringFieldOption>>;
    pattern?: Maybe<Scalars['String']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type StringFieldOption = {
    label?: Maybe<Array<LocalizedString>>;
    value: Scalars['String']['output'];
};

/** Operators for filtering on a list of String fields */
export type StringListOperators = {
    inList: Scalars['String']['input'];
};

/** Operators for filtering on a String field */
export type StringOperators = {
    contains?: InputMaybe<Scalars['String']['input']>;
    eq?: InputMaybe<Scalars['String']['input']>;
    in?: InputMaybe<Array<Scalars['String']['input']>>;
    isNull?: InputMaybe<Scalars['Boolean']['input']>;
    notContains?: InputMaybe<Scalars['String']['input']>;
    notEq?: InputMaybe<Scalars['String']['input']>;
    notIn?: InputMaybe<Array<Scalars['String']['input']>>;
    regex?: InputMaybe<Scalars['String']['input']>;
};

export type StringStructFieldConfig = StructField & {
    description?: Maybe<Array<LocalizedString>>;
    label?: Maybe<Array<LocalizedString>>;
    length?: Maybe<Scalars['Int']['output']>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    options?: Maybe<Array<StringFieldOption>>;
    pattern?: Maybe<Scalars['String']['output']>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type StructCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    fields: Array<StructFieldConfig>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type StructField = {
    description?: Maybe<Array<LocalizedString>>;
    label?: Maybe<Array<LocalizedString>>;
    list?: Maybe<Scalars['Boolean']['output']>;
    name: Scalars['String']['output'];
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type StructFieldConfig =
    | BooleanStructFieldConfig
    | DateTimeStructFieldConfig
    | FloatStructFieldConfig
    | IntStructFieldConfig
    | StringStructFieldConfig
    | TextStructFieldConfig;

/** Indicates that an operation succeeded, where we do not want to return any more specific information. */
export type Success = {
    success: Scalars['Boolean']['output'];
};

export type Surcharge = Node & {
    createdAt: Scalars['DateTime']['output'];
    description: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    price: Scalars['Money']['output'];
    priceWithTax: Scalars['Money']['output'];
    sku?: Maybe<Scalars['String']['output']>;
    taxLines: Array<TaxLine>;
    taxRate: Scalars['Float']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type Tag = Node & {
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    updatedAt: Scalars['DateTime']['output'];
    value: Scalars['String']['output'];
};

export type TagList = PaginatedList & {
    items: Array<Tag>;
    totalItems: Scalars['Int']['output'];
};

export type TaxCategory = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    isDefault: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type TaxLine = {
    description: Scalars['String']['output'];
    taxRate: Scalars['Float']['output'];
};

export type TaxRate = Node & {
    category: TaxCategory;
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    customerGroup?: Maybe<CustomerGroup>;
    enabled: Scalars['Boolean']['output'];
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
    value: Scalars['Float']['output'];
    zone: Zone;
};

export type TaxRateList = PaginatedList & {
    items: Array<TaxRate>;
    totalItems: Scalars['Int']['output'];
};

export type TextCustomFieldConfig = CustomField & {
    deprecated?: Maybe<Scalars['Boolean']['output']>;
    deprecationReason?: Maybe<Scalars['String']['output']>;
    description?: Maybe<Array<LocalizedString>>;
    internal?: Maybe<Scalars['Boolean']['output']>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    nullable?: Maybe<Scalars['Boolean']['output']>;
    readonly?: Maybe<Scalars['Boolean']['output']>;
    requiresPermission?: Maybe<Array<Permission>>;
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type TextStructFieldConfig = StructField & {
    description?: Maybe<Array<LocalizedString>>;
    label?: Maybe<Array<LocalizedString>>;
    list: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    type: Scalars['String']['output'];
    ui?: Maybe<Scalars['JSON']['output']>;
};

export type TransitionOrderToStateResult = Order | OrderStateTransitionError;

/**
 * Input used to update an Address.
 *
 * The countryCode must correspond to a `code` property of a Country that has been defined in the
 * Vendure server. The `code` property is typically a 2-character ISO code such as "GB", "US", "DE" etc.
 * If an invalid code is passed, the mutation will fail.
 */
export type UpdateAddressInput = {
    city?: InputMaybe<Scalars['String']['input']>;
    company?: InputMaybe<Scalars['String']['input']>;
    countryCode?: InputMaybe<Scalars['String']['input']>;
    customFields?: InputMaybe<Scalars['JSON']['input']>;
    defaultBillingAddress?: InputMaybe<Scalars['Boolean']['input']>;
    defaultShippingAddress?: InputMaybe<Scalars['Boolean']['input']>;
    fullName?: InputMaybe<Scalars['String']['input']>;
    id: Scalars['ID']['input'];
    phoneNumber?: InputMaybe<Scalars['String']['input']>;
    postalCode?: InputMaybe<Scalars['String']['input']>;
    province?: InputMaybe<Scalars['String']['input']>;
    streetLine1?: InputMaybe<Scalars['String']['input']>;
    streetLine2?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCustomerEmailAddressResult =
    | IdentifierChangeTokenExpiredError
    | IdentifierChangeTokenInvalidError
    | NativeAuthStrategyError
    | Success;

export type UpdateCustomerInput = {
    customFields?: InputMaybe<Scalars['JSON']['input']>;
    firstName?: InputMaybe<Scalars['String']['input']>;
    lastName?: InputMaybe<Scalars['String']['input']>;
    phoneNumber?: InputMaybe<Scalars['String']['input']>;
    title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCustomerPasswordResult =
    | InvalidCredentialsError
    | NativeAuthStrategyError
    | PasswordValidationError
    | Success;

/**
 * Returned when multiple items are added to an Order.
 * The errorResults array contains the errors that occurred for each item, if any.
 */
export type UpdateMultipleOrderItemsResult = {
    errorResults: Array<UpdateOrderItemErrorResult>;
    order: Order;
};

export type UpdateOrderInput = {
    customFields?: InputMaybe<Scalars['JSON']['input']>;
};

/** Union type of all possible errors that can occur when adding or removing items from an Order. */
export type UpdateOrderItemErrorResult =
    | InsufficientStockError
    | NegativeQuantityError
    | OrderInterceptorError
    | OrderLimitError
    | OrderModificationError;

export type UpdateOrderItemsResult =
    | InsufficientStockError
    | NegativeQuantityError
    | Order
    | OrderInterceptorError
    | OrderLimitError
    | OrderModificationError;

export type User = Node & {
    authenticationMethods: Array<AuthenticationMethod>;
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    identifier: Scalars['String']['output'];
    lastLogin?: Maybe<Scalars['DateTime']['output']>;
    roles: Array<Role>;
    updatedAt: Scalars['DateTime']['output'];
    verified: Scalars['Boolean']['output'];
};

/**
 * Returned if the verification token (used to verify a Customer's email address) is valid, but has
 * expired according to the `verificationTokenDuration` setting in the AuthOptions.
 */
export type VerificationTokenExpiredError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

/**
 * Returned if the verification token (used to verify a Customer's email address) is either
 * invalid or does not match any expected tokens.
 */
export type VerificationTokenInvalidError = ErrorResult & {
    errorCode: ErrorCode;
    message: Scalars['String']['output'];
};

export type VerifyCustomerAccountResult =
    | CurrentUser
    | MissingPasswordError
    | NativeAuthStrategyError
    | PasswordAlreadySetError
    | PasswordValidationError
    | VerificationTokenExpiredError
    | VerificationTokenInvalidError;

export type Zone = Node & {
    createdAt: Scalars['DateTime']['output'];
    customFields?: Maybe<Scalars['JSON']['output']>;
    id: Scalars['ID']['output'];
    members: Array<Region>;
    name: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};

export type TestOrderFragmentFragment = {
    id: string;
    code: string;
    state: string;
    active: boolean;
    subTotal: number;
    subTotalWithTax: number;
    shipping: number;
    shippingWithTax: number;
    total: number;
    totalWithTax: number;
    currencyCode: CurrencyCode;
    couponCodes: Array<string>;
    discounts: Array<{
        adjustmentSource: string;
        amount: number;
        amountWithTax: number;
        description: string;
        type: AdjustmentType;
    }>;
    lines: Array<{
        id: string;
        quantity: number;
        linePrice: number;
        linePriceWithTax: number;
        unitPrice: number;
        unitPriceWithTax: number;
        unitPriceChangeSinceAdded: number;
        unitPriceWithTaxChangeSinceAdded: number;
        discountedUnitPriceWithTax: number;
        proratedUnitPriceWithTax: number;
        productVariant: { id: string };
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
    }>;
    shippingLines: Array<{
        priceWithTax: number;
        shippingMethod: { id: string; code: string; description: string };
    }>;
    customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
    history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
};

export type UpdatedOrderFragment = {
    id: string;
    code: string;
    state: string;
    active: boolean;
    total: number;
    totalWithTax: number;
    currencyCode: CurrencyCode;
    lines: Array<{
        id: string;
        quantity: number;
        unitPrice: number;
        unitPriceWithTax: number;
        linePrice: number;
        linePriceWithTax: number;
        productVariant: { id: string };
        featuredAsset?: { id: string } | null;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
    }>;
    discounts: Array<{
        adjustmentSource: string;
        amount: number;
        amountWithTax: number;
        description: string;
        type: AdjustmentType;
    }>;
};

export type AddItemToOrderMutationVariables = Exact<{
    productVariantId: Scalars['ID']['input'];
    quantity: Scalars['Int']['input'];
}>;

export type AddItemToOrderMutation = {
    addItemToOrder:
        | {
              errorCode: ErrorCode;
              message: string;
              quantityAvailable: number;
              order: {
                  id: string;
                  code: string;
                  state: string;
                  active: boolean;
                  total: number;
                  totalWithTax: number;
                  currencyCode: CurrencyCode;
                  lines: Array<{
                      id: string;
                      quantity: number;
                      unitPrice: number;
                      unitPriceWithTax: number;
                      linePrice: number;
                      linePriceWithTax: number;
                      productVariant: { id: string };
                      featuredAsset?: { id: string } | null;
                      discounts: Array<{
                          adjustmentSource: string;
                          amount: number;
                          amountWithTax: number;
                          description: string;
                          type: AdjustmentType;
                      }>;
                  }>;
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              };
          }
        | { errorCode: ErrorCode; message: string }
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              lines: Array<{
                  id: string;
                  quantity: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  productVariant: { id: string };
                  featuredAsset?: { id: string } | null;
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
          }
        | { errorCode: ErrorCode; message: string; interceptorError: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string };
};

export type AddItemsToOrderMutationVariables = Exact<{
    inputs: Array<AddItemInput> | AddItemInput;
}>;

export type AddItemsToOrderMutation = {
    addItemsToOrder: {
        order: {
            id: string;
            code: string;
            state: string;
            active: boolean;
            total: number;
            totalWithTax: number;
            currencyCode: CurrencyCode;
            lines: Array<{
                id: string;
                quantity: number;
                unitPrice: number;
                unitPriceWithTax: number;
                linePrice: number;
                linePriceWithTax: number;
                productVariant: { id: string };
                featuredAsset?: { id: string } | null;
                discounts: Array<{
                    adjustmentSource: string;
                    amount: number;
                    amountWithTax: number;
                    description: string;
                    type: AdjustmentType;
                }>;
            }>;
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        };
        errorResults: Array<
            | { errorCode: ErrorCode; message: string }
            | { errorCode: ErrorCode; message: string }
            | { errorCode: ErrorCode; message: string }
            | { errorCode: ErrorCode; message: string }
            | { errorCode: ErrorCode; message: string }
        >;
    };
};

export type SetCurrencyCodeForOrderMutationVariables = Exact<{
    currencyCode: CurrencyCode;
}>;

export type SetCurrencyCodeForOrderMutation = {
    setCurrencyCodeForOrder:
        | {
              errorCode: ErrorCode;
              message: string;
              quantityAvailable: number;
              order: {
                  id: string;
                  code: string;
                  state: string;
                  active: boolean;
                  total: number;
                  totalWithTax: number;
                  currencyCode: CurrencyCode;
                  lines: Array<{
                      id: string;
                      quantity: number;
                      unitPrice: number;
                      unitPriceWithTax: number;
                      linePrice: number;
                      linePriceWithTax: number;
                      productVariant: { id: string };
                      featuredAsset?: { id: string } | null;
                      discounts: Array<{
                          adjustmentSource: string;
                          amount: number;
                          amountWithTax: number;
                          description: string;
                          type: AdjustmentType;
                      }>;
                  }>;
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              };
          }
        | { errorCode: ErrorCode; message: string }
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              lines: Array<{
                  id: string;
                  quantity: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  productVariant: { id: string };
                  featuredAsset?: { id: string } | null;
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
          }
        | { errorCode: ErrorCode; message: string; interceptorError: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string };
};

export type SearchProductsShopQueryVariables = Exact<{
    input: SearchInput;
}>;

export type SearchProductsShopQuery = {
    search: {
        totalItems: number;
        items: Array<{
            productId: string;
            productName: string;
            productVariantId: string;
            productVariantName: string;
            sku: string;
            collectionIds: Array<string>;
            price: { min: number; max: number } | { value: number };
        }>;
    };
};

export type RegisterMutationVariables = Exact<{
    input: RegisterCustomerInput;
}>;

export type RegisterMutation = {
    registerCustomerAccount:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string; validationErrorMessage: string }
        | { success: boolean };
};

export type CurrentUserShopFragment = {
    id: string;
    identifier: string;
    channels: Array<{ code: string; token: string; permissions: Array<Permission> }>;
};

export type VerifyMutationVariables = Exact<{
    password?: InputMaybe<Scalars['String']['input']>;
    token: Scalars['String']['input'];
}>;

export type VerifyMutation = {
    verifyCustomerAccount:
        | {
              id: string;
              identifier: string;
              channels: Array<{ code: string; token: string; permissions: Array<Permission> }>;
          }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string; validationErrorMessage: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string };
};

export type RefreshTokenMutationVariables = Exact<{
    emailAddress: Scalars['String']['input'];
}>;

export type RefreshTokenMutation = {
    refreshCustomerVerification: { errorCode: ErrorCode; message: string } | { success: boolean };
};

export type RequestPasswordResetMutationVariables = Exact<{
    identifier: Scalars['String']['input'];
}>;

export type RequestPasswordResetMutation = {
    requestPasswordReset?: { errorCode: ErrorCode; message: string } | { success: boolean } | null;
};

export type ResetPasswordMutationVariables = Exact<{
    token: Scalars['String']['input'];
    password: Scalars['String']['input'];
}>;

export type ResetPasswordMutation = {
    resetPassword:
        | {
              id: string;
              identifier: string;
              channels: Array<{ code: string; token: string; permissions: Array<Permission> }>;
          }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string; validationErrorMessage: string };
};

export type RequestUpdateEmailAddressMutationVariables = Exact<{
    password: Scalars['String']['input'];
    newEmailAddress: Scalars['String']['input'];
}>;

export type RequestUpdateEmailAddressMutation = {
    requestUpdateCustomerEmailAddress:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { success: boolean };
};

export type UpdateEmailAddressMutationVariables = Exact<{
    token: Scalars['String']['input'];
}>;

export type UpdateEmailAddressMutation = {
    updateCustomerEmailAddress:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { success: boolean };
};

export type GetActiveCustomerQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveCustomerQuery = { activeCustomer?: { id: string; emailAddress: string } | null };

export type CreateAddressShopMutationVariables = Exact<{
    input: CreateAddressInput;
}>;

export type CreateAddressShopMutation = {
    createCustomerAddress: { id: string; streetLine1: string; country: { code: string } };
};

export type UpdateAddressShopMutationVariables = Exact<{
    input: UpdateAddressInput;
}>;

export type UpdateAddressShopMutation = {
    updateCustomerAddress: { streetLine1: string; country: { code: string } };
};

export type DeleteAddressShopMutationVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type DeleteAddressShopMutation = { deleteCustomerAddress: { success: boolean } };

export type UpdateCustomerMutationVariables = Exact<{
    input: UpdateCustomerInput;
}>;

export type UpdateCustomerMutation = { updateCustomer: { id: string; firstName: string; lastName: string } };

export type UpdatePasswordMutationVariables = Exact<{
    old: Scalars['String']['input'];
    new: Scalars['String']['input'];
}>;

export type UpdatePasswordMutation = {
    updateCustomerPassword:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { success: boolean };
};

export type GetActiveOrderQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveOrderQuery = {
    activeOrder?: {
        id: string;
        code: string;
        state: string;
        active: boolean;
        subTotal: number;
        subTotalWithTax: number;
        shipping: number;
        shippingWithTax: number;
        total: number;
        totalWithTax: number;
        currencyCode: CurrencyCode;
        couponCodes: Array<string>;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
        lines: Array<{
            id: string;
            quantity: number;
            linePrice: number;
            linePriceWithTax: number;
            unitPrice: number;
            unitPriceWithTax: number;
            unitPriceChangeSinceAdded: number;
            unitPriceWithTaxChangeSinceAdded: number;
            discountedUnitPriceWithTax: number;
            proratedUnitPriceWithTax: number;
            productVariant: { id: string };
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        }>;
        shippingLines: Array<{
            priceWithTax: number;
            shippingMethod: { id: string; code: string; description: string };
        }>;
        customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
        history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
    } | null;
};

export type GetActiveOrderWithPriceDataQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveOrderWithPriceDataQuery = {
    activeOrder?: {
        id: string;
        subTotal: number;
        subTotalWithTax: number;
        total: number;
        totalWithTax: number;
        lines: Array<{
            id: string;
            unitPrice: number;
            unitPriceWithTax: number;
            taxRate: number;
            linePrice: number;
            lineTax: number;
            linePriceWithTax: number;
            taxLines: Array<{ taxRate: number; description: string }>;
        }>;
        taxSummary: Array<{ description: string; taxRate: number; taxBase: number; taxTotal: number }>;
    } | null;
};

export type AdjustItemQuantityMutationVariables = Exact<{
    orderLineId: Scalars['ID']['input'];
    quantity: Scalars['Int']['input'];
}>;

export type AdjustItemQuantityMutation = {
    adjustOrderLine:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              subTotal: number;
              subTotalWithTax: number;
              shipping: number;
              shippingWithTax: number;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              couponCodes: Array<string>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
              lines: Array<{
                  id: string;
                  quantity: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  unitPriceChangeSinceAdded: number;
                  unitPriceWithTaxChangeSinceAdded: number;
                  discountedUnitPriceWithTax: number;
                  proratedUnitPriceWithTax: number;
                  productVariant: { id: string };
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              shippingLines: Array<{
                  priceWithTax: number;
                  shippingMethod: { id: string; code: string; description: string };
              }>;
              customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
              history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
          }
        | { errorCode: ErrorCode; message: string; interceptorError: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string };
};

export type RemoveItemFromOrderMutationVariables = Exact<{
    orderLineId: Scalars['ID']['input'];
}>;

export type RemoveItemFromOrderMutation = {
    removeOrderLine:
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              subTotal: number;
              subTotalWithTax: number;
              shipping: number;
              shippingWithTax: number;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              couponCodes: Array<string>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
              lines: Array<{
                  id: string;
                  quantity: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  unitPriceChangeSinceAdded: number;
                  unitPriceWithTaxChangeSinceAdded: number;
                  discountedUnitPriceWithTax: number;
                  proratedUnitPriceWithTax: number;
                  productVariant: { id: string };
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              shippingLines: Array<{
                  priceWithTax: number;
                  shippingMethod: { id: string; code: string; description: string };
              }>;
              customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
              history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
          }
        | { errorCode: ErrorCode; message: string; interceptorError: string }
        | { errorCode: ErrorCode; message: string };
};

export type GetShippingMethodsQueryVariables = Exact<{ [key: string]: never }>;

export type GetShippingMethodsQuery = {
    eligibleShippingMethods: Array<{
        id: string;
        code: string;
        price: number;
        name: string;
        description: string;
    }>;
};

export type SetShippingMethodMutationVariables = Exact<{
    id: Array<Scalars['ID']['input']> | Scalars['ID']['input'];
}>;

export type SetShippingMethodMutation = {
    setOrderShippingMethod:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              subTotal: number;
              subTotalWithTax: number;
              shipping: number;
              shippingWithTax: number;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              couponCodes: Array<string>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
              lines: Array<{
                  id: string;
                  quantity: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  unitPriceChangeSinceAdded: number;
                  unitPriceWithTaxChangeSinceAdded: number;
                  discountedUnitPriceWithTax: number;
                  proratedUnitPriceWithTax: number;
                  productVariant: { id: string };
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              shippingLines: Array<{
                  priceWithTax: number;
                  shippingMethod: { id: string; code: string; description: string };
              }>;
              customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
              history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
          }
        | { errorCode: ErrorCode; message: string };
};

export type ActiveOrderCustomerFragment = {
    id: string;
    customer?: { id: string; emailAddress: string; firstName: string; lastName: string } | null;
    lines: Array<{ id: string }>;
};

export type SetCustomerForOrderMutationVariables = Exact<{
    input: CreateCustomerInput;
}>;

export type SetCustomerForOrderMutation = {
    setCustomerForOrder:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string; errorDetail: string }
        | { errorCode: ErrorCode; message: string }
        | {
              id: string;
              customer?: { id: string; emailAddress: string; firstName: string; lastName: string } | null;
              lines: Array<{ id: string }>;
          };
};

export type GetOrderByCodeQueryVariables = Exact<{
    code: Scalars['String']['input'];
}>;

export type GetOrderByCodeQuery = {
    orderByCode?: {
        id: string;
        code: string;
        state: string;
        active: boolean;
        subTotal: number;
        subTotalWithTax: number;
        shipping: number;
        shippingWithTax: number;
        total: number;
        totalWithTax: number;
        currencyCode: CurrencyCode;
        couponCodes: Array<string>;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
        lines: Array<{
            id: string;
            quantity: number;
            linePrice: number;
            linePriceWithTax: number;
            unitPrice: number;
            unitPriceWithTax: number;
            unitPriceChangeSinceAdded: number;
            unitPriceWithTaxChangeSinceAdded: number;
            discountedUnitPriceWithTax: number;
            proratedUnitPriceWithTax: number;
            productVariant: { id: string };
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        }>;
        shippingLines: Array<{
            priceWithTax: number;
            shippingMethod: { id: string; code: string; description: string };
        }>;
        customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
        history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
    } | null;
};

export type GetOrderShopQueryVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type GetOrderShopQuery = {
    order?: {
        id: string;
        code: string;
        state: string;
        active: boolean;
        subTotal: number;
        subTotalWithTax: number;
        shipping: number;
        shippingWithTax: number;
        total: number;
        totalWithTax: number;
        currencyCode: CurrencyCode;
        couponCodes: Array<string>;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
        lines: Array<{
            id: string;
            quantity: number;
            linePrice: number;
            linePriceWithTax: number;
            unitPrice: number;
            unitPriceWithTax: number;
            unitPriceChangeSinceAdded: number;
            unitPriceWithTaxChangeSinceAdded: number;
            discountedUnitPriceWithTax: number;
            proratedUnitPriceWithTax: number;
            productVariant: { id: string };
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        }>;
        shippingLines: Array<{
            priceWithTax: number;
            shippingMethod: { id: string; code: string; description: string };
        }>;
        customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
        history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
    } | null;
};

export type GetOrderPromotionsByCodeQueryVariables = Exact<{
    code: Scalars['String']['input'];
}>;

export type GetOrderPromotionsByCodeQuery = {
    orderByCode?: {
        id: string;
        code: string;
        state: string;
        active: boolean;
        subTotal: number;
        subTotalWithTax: number;
        shipping: number;
        shippingWithTax: number;
        total: number;
        totalWithTax: number;
        currencyCode: CurrencyCode;
        couponCodes: Array<string>;
        promotions: Array<{ id: string; name: string }>;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
        lines: Array<{
            id: string;
            quantity: number;
            linePrice: number;
            linePriceWithTax: number;
            unitPrice: number;
            unitPriceWithTax: number;
            unitPriceChangeSinceAdded: number;
            unitPriceWithTaxChangeSinceAdded: number;
            discountedUnitPriceWithTax: number;
            proratedUnitPriceWithTax: number;
            productVariant: { id: string };
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        }>;
        shippingLines: Array<{
            priceWithTax: number;
            shippingMethod: { id: string; code: string; description: string };
        }>;
        customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
        history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
    } | null;
};

export type GetAvailableCountriesQueryVariables = Exact<{ [key: string]: never }>;

export type GetAvailableCountriesQuery = { availableCountries: Array<{ id: string; code: string }> };

export type TransitionToStateMutationVariables = Exact<{
    state: Scalars['String']['input'];
}>;

export type TransitionToStateMutation = {
    transitionOrderToState?:
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              subTotal: number;
              subTotalWithTax: number;
              shipping: number;
              shippingWithTax: number;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              couponCodes: Array<string>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
              lines: Array<{
                  id: string;
                  quantity: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  unitPriceChangeSinceAdded: number;
                  unitPriceWithTaxChangeSinceAdded: number;
                  discountedUnitPriceWithTax: number;
                  proratedUnitPriceWithTax: number;
                  productVariant: { id: string };
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              shippingLines: Array<{
                  priceWithTax: number;
                  shippingMethod: { id: string; code: string; description: string };
              }>;
              customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
              history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
          }
        | {
              errorCode: ErrorCode;
              message: string;
              transitionError: string;
              fromState: string;
              toState: string;
          }
        | null;
};

export type OrderWithAddressesFragment = {
    lines: Array<{ id: string }>;
    shippingAddress?: {
        fullName?: string | null;
        company?: string | null;
        streetLine1?: string | null;
        streetLine2?: string | null;
        city?: string | null;
        province?: string | null;
        postalCode?: string | null;
        country?: string | null;
        phoneNumber?: string | null;
    } | null;
    billingAddress?: {
        fullName?: string | null;
        company?: string | null;
        streetLine1?: string | null;
        streetLine2?: string | null;
        city?: string | null;
        province?: string | null;
        postalCode?: string | null;
        country?: string | null;
        phoneNumber?: string | null;
    } | null;
};

export type SetShippingAddressMutationVariables = Exact<{
    input: CreateAddressInput;
}>;

export type SetShippingAddressMutation = {
    setOrderShippingAddress:
        | { errorCode: ErrorCode; message: string }
        | {
              lines: Array<{ id: string }>;
              shippingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
              billingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
          };
};

export type SetBillingAddressMutationVariables = Exact<{
    input: CreateAddressInput;
}>;

export type SetBillingAddressMutation = {
    setOrderBillingAddress:
        | { errorCode: ErrorCode; message: string }
        | {
              lines: Array<{ id: string }>;
              shippingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
              billingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
          };
};

export type UnsetShippingAddressMutationVariables = Exact<{ [key: string]: never }>;

export type UnsetShippingAddressMutation = {
    unsetOrderShippingAddress:
        | { errorCode: ErrorCode; message: string }
        | {
              lines: Array<{ id: string }>;
              shippingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
              billingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
          };
};

export type UnsetBillingAddressMutationVariables = Exact<{ [key: string]: never }>;

export type UnsetBillingAddressMutation = {
    unsetOrderBillingAddress:
        | { errorCode: ErrorCode; message: string }
        | {
              lines: Array<{ id: string }>;
              shippingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
              billingAddress?: {
                  fullName?: string | null;
                  company?: string | null;
                  streetLine1?: string | null;
                  streetLine2?: string | null;
                  city?: string | null;
                  province?: string | null;
                  postalCode?: string | null;
                  country?: string | null;
                  phoneNumber?: string | null;
              } | null;
          };
};

export type TestOrderWithPaymentsFragment = {
    id: string;
    code: string;
    state: string;
    active: boolean;
    subTotal: number;
    subTotalWithTax: number;
    shipping: number;
    shippingWithTax: number;
    total: number;
    totalWithTax: number;
    currencyCode: CurrencyCode;
    couponCodes: Array<string>;
    payments?: Array<{
        id: string;
        transactionId?: string | null;
        method: string;
        amount: number;
        state: string;
        metadata?: any | null;
    }> | null;
    discounts: Array<{
        adjustmentSource: string;
        amount: number;
        amountWithTax: number;
        description: string;
        type: AdjustmentType;
    }>;
    lines: Array<{
        id: string;
        quantity: number;
        linePrice: number;
        linePriceWithTax: number;
        unitPrice: number;
        unitPriceWithTax: number;
        unitPriceChangeSinceAdded: number;
        unitPriceWithTaxChangeSinceAdded: number;
        discountedUnitPriceWithTax: number;
        proratedUnitPriceWithTax: number;
        productVariant: { id: string };
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
    }>;
    shippingLines: Array<{
        priceWithTax: number;
        shippingMethod: { id: string; code: string; description: string };
    }>;
    customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
    history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
};

export type GetActiveOrderWithPaymentsQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveOrderWithPaymentsQuery = {
    activeOrder?: {
        id: string;
        code: string;
        state: string;
        active: boolean;
        subTotal: number;
        subTotalWithTax: number;
        shipping: number;
        shippingWithTax: number;
        total: number;
        totalWithTax: number;
        currencyCode: CurrencyCode;
        couponCodes: Array<string>;
        payments?: Array<{
            id: string;
            transactionId?: string | null;
            method: string;
            amount: number;
            state: string;
            metadata?: any | null;
        }> | null;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
        lines: Array<{
            id: string;
            quantity: number;
            linePrice: number;
            linePriceWithTax: number;
            unitPrice: number;
            unitPriceWithTax: number;
            unitPriceChangeSinceAdded: number;
            unitPriceWithTaxChangeSinceAdded: number;
            discountedUnitPriceWithTax: number;
            proratedUnitPriceWithTax: number;
            productVariant: { id: string };
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        }>;
        shippingLines: Array<{
            priceWithTax: number;
            shippingMethod: { id: string; code: string; description: string };
        }>;
        customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
        history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
    } | null;
};

export type AddPaymentToOrderMutationVariables = Exact<{
    input: PaymentInput;
}>;

export type AddPaymentToOrderMutation = {
    addPaymentToOrder:
        | { errorCode: ErrorCode; message: string; eligibilityCheckerMessage?: string | null }
        | { errorCode: ErrorCode; message: string }
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              subTotal: number;
              subTotalWithTax: number;
              shipping: number;
              shippingWithTax: number;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              couponCodes: Array<string>;
              payments?: Array<{
                  id: string;
                  transactionId?: string | null;
                  method: string;
                  amount: number;
                  state: string;
                  metadata?: any | null;
              }> | null;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
              lines: Array<{
                  id: string;
                  quantity: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  unitPriceChangeSinceAdded: number;
                  unitPriceWithTaxChangeSinceAdded: number;
                  discountedUnitPriceWithTax: number;
                  proratedUnitPriceWithTax: number;
                  productVariant: { id: string };
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              shippingLines: Array<{
                  priceWithTax: number;
                  shippingMethod: { id: string; code: string; description: string };
              }>;
              customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
              history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
          }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string; transitionError: string }
        | { errorCode: ErrorCode; message: string; paymentErrorMessage: string }
        | { errorCode: ErrorCode; message: string; paymentErrorMessage: string };
};

export type GetActiveOrderPaymentsQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveOrderPaymentsQuery = {
    activeOrder?: {
        id: string;
        payments?: Array<{
            id: string;
            transactionId?: string | null;
            method: string;
            amount: number;
            state: string;
            errorMessage?: string | null;
            metadata?: any | null;
        }> | null;
    } | null;
};

export type GetOrderByCodeWithPaymentsQueryVariables = Exact<{
    code: Scalars['String']['input'];
}>;

export type GetOrderByCodeWithPaymentsQuery = {
    orderByCode?: {
        id: string;
        code: string;
        state: string;
        active: boolean;
        subTotal: number;
        subTotalWithTax: number;
        shipping: number;
        shippingWithTax: number;
        total: number;
        totalWithTax: number;
        currencyCode: CurrencyCode;
        couponCodes: Array<string>;
        payments?: Array<{
            id: string;
            transactionId?: string | null;
            method: string;
            amount: number;
            state: string;
            metadata?: any | null;
        }> | null;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
        lines: Array<{
            id: string;
            quantity: number;
            linePrice: number;
            linePriceWithTax: number;
            unitPrice: number;
            unitPriceWithTax: number;
            unitPriceChangeSinceAdded: number;
            unitPriceWithTaxChangeSinceAdded: number;
            discountedUnitPriceWithTax: number;
            proratedUnitPriceWithTax: number;
            productVariant: { id: string };
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        }>;
        shippingLines: Array<{
            priceWithTax: number;
            shippingMethod: { id: string; code: string; description: string };
        }>;
        customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
        history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
    } | null;
};

export type GetActiveCustomerOrderWithItemFulfillmentsQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveCustomerOrderWithItemFulfillmentsQuery = {
    activeCustomer?: {
        orders: {
            totalItems: number;
            items: Array<{
                id: string;
                code: string;
                state: string;
                lines: Array<{ id: string }>;
                fulfillments?: Array<{
                    id: string;
                    state: string;
                    method: string;
                    trackingCode?: string | null;
                }> | null;
            }>;
        };
    } | null;
};

export type GetNextOrderStatesQueryVariables = Exact<{ [key: string]: never }>;

export type GetNextOrderStatesQuery = { nextOrderStates: Array<string> };

export type GetCustomerAddressesQueryVariables = Exact<{ [key: string]: never }>;

export type GetCustomerAddressesQuery = {
    activeOrder?: {
        customer?: { addresses?: Array<{ id: string; streetLine1: string }> | null } | null;
    } | null;
};

export type GetCustomerOrdersQueryVariables = Exact<{ [key: string]: never }>;

export type GetCustomerOrdersQuery = {
    activeOrder?: { customer?: { orders: { items: Array<{ id: string }> } } | null } | null;
};

export type GetActiveCustomerOrdersQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveCustomerOrdersQuery = {
    activeCustomer?: {
        id: string;
        orders: { totalItems: number; items: Array<{ id: string; state: string }> };
    } | null;
};

export type ApplyCouponCodeMutationVariables = Exact<{
    couponCode: Scalars['String']['input'];
}>;

export type ApplyCouponCodeMutation = {
    applyCouponCode:
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string }
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              subTotal: number;
              subTotalWithTax: number;
              shipping: number;
              shippingWithTax: number;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              couponCodes: Array<string>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
              lines: Array<{
                  id: string;
                  quantity: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  unitPriceChangeSinceAdded: number;
                  unitPriceWithTaxChangeSinceAdded: number;
                  discountedUnitPriceWithTax: number;
                  proratedUnitPriceWithTax: number;
                  productVariant: { id: string };
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              shippingLines: Array<{
                  priceWithTax: number;
                  shippingMethod: { id: string; code: string; description: string };
              }>;
              customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
              history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
          };
};

export type RemoveCouponCodeMutationVariables = Exact<{
    couponCode: Scalars['String']['input'];
}>;

export type RemoveCouponCodeMutation = {
    removeCouponCode?: {
        id: string;
        code: string;
        state: string;
        active: boolean;
        subTotal: number;
        subTotalWithTax: number;
        shipping: number;
        shippingWithTax: number;
        total: number;
        totalWithTax: number;
        currencyCode: CurrencyCode;
        couponCodes: Array<string>;
        discounts: Array<{
            adjustmentSource: string;
            amount: number;
            amountWithTax: number;
            description: string;
            type: AdjustmentType;
        }>;
        lines: Array<{
            id: string;
            quantity: number;
            linePrice: number;
            linePriceWithTax: number;
            unitPrice: number;
            unitPriceWithTax: number;
            unitPriceChangeSinceAdded: number;
            unitPriceWithTaxChangeSinceAdded: number;
            discountedUnitPriceWithTax: number;
            proratedUnitPriceWithTax: number;
            productVariant: { id: string };
            discounts: Array<{
                adjustmentSource: string;
                amount: number;
                amountWithTax: number;
                description: string;
                type: AdjustmentType;
            }>;
        }>;
        shippingLines: Array<{
            priceWithTax: number;
            shippingMethod: { id: string; code: string; description: string };
        }>;
        customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
        history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
    } | null;
};

export type RemoveAllOrderLinesMutationVariables = Exact<{ [key: string]: never }>;

export type RemoveAllOrderLinesMutation = {
    removeAllOrderLines:
        | {
              id: string;
              code: string;
              state: string;
              active: boolean;
              subTotal: number;
              subTotalWithTax: number;
              shipping: number;
              shippingWithTax: number;
              total: number;
              totalWithTax: number;
              currencyCode: CurrencyCode;
              couponCodes: Array<string>;
              discounts: Array<{
                  adjustmentSource: string;
                  amount: number;
                  amountWithTax: number;
                  description: string;
                  type: AdjustmentType;
              }>;
              lines: Array<{
                  id: string;
                  quantity: number;
                  linePrice: number;
                  linePriceWithTax: number;
                  unitPrice: number;
                  unitPriceWithTax: number;
                  unitPriceChangeSinceAdded: number;
                  unitPriceWithTaxChangeSinceAdded: number;
                  discountedUnitPriceWithTax: number;
                  proratedUnitPriceWithTax: number;
                  productVariant: { id: string };
                  discounts: Array<{
                      adjustmentSource: string;
                      amount: number;
                      amountWithTax: number;
                      description: string;
                      type: AdjustmentType;
                  }>;
              }>;
              shippingLines: Array<{
                  priceWithTax: number;
                  shippingMethod: { id: string; code: string; description: string };
              }>;
              customer?: { id: string; user?: { id: string; identifier: string } | null } | null;
              history: { items: Array<{ id: string; type: HistoryEntryType; data: any }> };
          }
        | { errorCode: ErrorCode; message: string }
        | { errorCode: ErrorCode; message: string };
};

export type GetEligiblePaymentMethodsQueryVariables = Exact<{ [key: string]: never }>;

export type GetEligiblePaymentMethodsQuery = {
    eligiblePaymentMethods: Array<{
        id: string;
        code: string;
        eligibilityMessage?: string | null;
        isEligible: boolean;
    }>;
};

export type GetProductStockLevelQueryVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type GetProductStockLevelQuery = {
    product?: { id: string; variants: Array<{ id: string; stockLevel: string }> } | null;
};

export type GetActiveCustomerWithOrdersProductSlugQueryVariables = Exact<{
    options?: InputMaybe<OrderListOptions>;
}>;

export type GetActiveCustomerWithOrdersProductSlugQuery = {
    activeCustomer?: {
        orders: { items: Array<{ lines: Array<{ productVariant: { product: { slug: string } } }> }> };
    } | null;
};

export type GetActiveCustomerWithOrdersProductPriceQueryVariables = Exact<{
    options?: InputMaybe<OrderListOptions>;
}>;

export type GetActiveCustomerWithOrdersProductPriceQuery = {
    activeCustomer?: {
        orders: {
            items: Array<{
                lines: Array<{
                    linePrice: number;
                    productVariant: { id: string; name: string; price: number };
                }>;
            }>;
        };
    } | null;
};

export type ActivePaymentMethodsQueryVariables = Exact<{ [key: string]: never }>;

export type ActivePaymentMethodsQuery = {
    activePaymentMethods: Array<{
        id: string;
        code: string;
        name: string;
        description?: string | null;
        translations: Array<{ languageCode: LanguageCode; name: string; description: string }>;
    } | null>;
};

export type GetActiveShippingMethodsQueryVariables = Exact<{ [key: string]: never }>;

export type GetActiveShippingMethodsQuery = {
    activeShippingMethods: Array<{
        id: string;
        code: string;
        name: string;
        description?: string | null;
        translations: Array<{ languageCode: LanguageCode; name: string; description: string }>;
    } | null>;
};

export const UpdatedOrderFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'UpdatedOrder' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'featuredAsset' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UpdatedOrderFragment, unknown>;
export const CurrentUserShopFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'CurrentUserShop' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'channels' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'token' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'permissions' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<CurrentUserShopFragment, unknown>;
export const ActiveOrderCustomerFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'ActiveOrderCustomer' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'emailAddress' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'firstName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'lastName' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<ActiveOrderCustomerFragment, unknown>;
export const OrderWithAddressesFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'OrderWithAddresses' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'billingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<OrderWithAddressesFragment, unknown>;
export const TestOrderFragmentFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<TestOrderFragmentFragment, unknown>;
export const TestOrderWithPaymentsFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderWithPayments' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'FragmentSpread', name: { kind: 'Name', value: 'TestOrderFragment' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'payments' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'transactionId' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'method' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'metadata' } },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<TestOrderWithPaymentsFragment, unknown>;
export const AddItemToOrderDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'AddItemToOrder' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'productVariantId' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'quantity' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'addItemToOrder' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'productVariantId' },
                                value: {
                                    kind: 'Variable',
                                    name: { kind: 'Name', value: 'productVariantId' },
                                },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'quantity' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'quantity' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'UpdatedOrder' } },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'InsufficientStockError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'quantityAvailable' },
                                            },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'order' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'FragmentSpread',
                                                            name: { kind: 'Name', value: 'UpdatedOrder' },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'OrderInterceptorError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'interceptorError' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'UpdatedOrder' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'featuredAsset' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<AddItemToOrderMutation, AddItemToOrderMutationVariables>;
export const AddItemsToOrderDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'AddItemsToOrder' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'inputs' } },
                    type: {
                        kind: 'NonNullType',
                        type: {
                            kind: 'ListType',
                            type: {
                                kind: 'NonNullType',
                                type: { kind: 'NamedType', name: { kind: 'Name', value: 'AddItemInput' } },
                            },
                        },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'addItemsToOrder' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'inputs' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'inputs' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'order' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'FragmentSpread',
                                                name: { kind: 'Name', value: 'UpdatedOrder' },
                                            },
                                        ],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'errorResults' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'InlineFragment',
                                                typeCondition: {
                                                    kind: 'NamedType',
                                                    name: { kind: 'Name', value: 'ErrorResult' },
                                                },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'errorCode' },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'message' },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'UpdatedOrder' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'featuredAsset' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<AddItemsToOrderMutation, AddItemsToOrderMutationVariables>;
export const SetCurrencyCodeForOrderDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'SetCurrencyCodeForOrder' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'currencyCode' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrencyCode' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'setCurrencyCodeForOrder' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'currencyCode' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'currencyCode' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'UpdatedOrder' } },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'InsufficientStockError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'quantityAvailable' },
                                            },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'order' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'FragmentSpread',
                                                            name: { kind: 'Name', value: 'UpdatedOrder' },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'OrderInterceptorError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'interceptorError' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'UpdatedOrder' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'featuredAsset' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<SetCurrencyCodeForOrderMutation, SetCurrencyCodeForOrderMutationVariables>;
export const SearchProductsShopDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'SearchProductsShop' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'SearchInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'search' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'totalItems' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'productId' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'productName' } },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'productVariantId' },
                                            },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'productVariantName' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'sku' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'collectionIds' } },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'price' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'InlineFragment',
                                                            typeCondition: {
                                                                kind: 'NamedType',
                                                                name: { kind: 'Name', value: 'SinglePrice' },
                                                            },
                                                            selectionSet: {
                                                                kind: 'SelectionSet',
                                                                selections: [
                                                                    {
                                                                        kind: 'Field',
                                                                        name: {
                                                                            kind: 'Name',
                                                                            value: 'value',
                                                                        },
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                        {
                                                            kind: 'InlineFragment',
                                                            typeCondition: {
                                                                kind: 'NamedType',
                                                                name: { kind: 'Name', value: 'PriceRange' },
                                                            },
                                                            selectionSet: {
                                                                kind: 'SelectionSet',
                                                                selections: [
                                                                    {
                                                                        kind: 'Field',
                                                                        name: { kind: 'Name', value: 'min' },
                                                                    },
                                                                    {
                                                                        kind: 'Field',
                                                                        name: { kind: 'Name', value: 'max' },
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<SearchProductsShopQuery, SearchProductsShopQueryVariables>;
export const RegisterDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'Register' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'RegisterCustomerInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'registerCustomerAccount' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'Success' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'PasswordValidationError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'validationErrorMessage' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<RegisterMutation, RegisterMutationVariables>;
export const VerifyDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'Verify' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'password' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'token' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'verifyCustomerAccount' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'password' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'password' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'token' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'token' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'CurrentUserShop' } },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'PasswordValidationError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'validationErrorMessage' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'CurrentUserShop' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'channels' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'token' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'permissions' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<VerifyMutation, VerifyMutationVariables>;
export const RefreshTokenDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'RefreshToken' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'emailAddress' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'refreshCustomerVerification' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'emailAddress' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'emailAddress' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'Success' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<RefreshTokenMutation, RefreshTokenMutationVariables>;
export const RequestPasswordResetDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'RequestPasswordReset' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'identifier' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'requestPasswordReset' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'emailAddress' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'identifier' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'Success' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<RequestPasswordResetMutation, RequestPasswordResetMutationVariables>;
export const ResetPasswordDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'ResetPassword' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'token' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'password' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'resetPassword' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'token' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'token' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'password' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'password' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'FragmentSpread', name: { kind: 'Name', value: 'CurrentUserShop' } },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'PasswordValidationError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'validationErrorMessage' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'CurrentUserShop' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'CurrentUser' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'channels' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'token' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'permissions' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<ResetPasswordMutation, ResetPasswordMutationVariables>;
export const RequestUpdateEmailAddressDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'RequestUpdateEmailAddress' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'password' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'newEmailAddress' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'requestUpdateCustomerEmailAddress' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'password' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'password' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'newEmailAddress' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'newEmailAddress' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'Success' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<RequestUpdateEmailAddressMutation, RequestUpdateEmailAddressMutationVariables>;
export const UpdateEmailAddressDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UpdateEmailAddress' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'token' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'updateCustomerEmailAddress' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'token' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'token' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'Success' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UpdateEmailAddressMutation, UpdateEmailAddressMutationVariables>;
export const GetActiveCustomerDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveCustomer' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeCustomer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'emailAddress' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetActiveCustomerQuery, GetActiveCustomerQueryVariables>;
export const CreateAddressShopDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'CreateAddressShop' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'CreateAddressInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'createCustomerAddress' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'country' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<CreateAddressShopMutation, CreateAddressShopMutationVariables>;
export const UpdateAddressShopDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UpdateAddressShop' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'UpdateAddressInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'updateCustomerAddress' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'country' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UpdateAddressShopMutation, UpdateAddressShopMutationVariables>;
export const DeleteAddressShopDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'DeleteAddressShop' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'deleteCustomerAddress' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'success' } }],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<DeleteAddressShopMutation, DeleteAddressShopMutationVariables>;
export const UpdateCustomerDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UpdateCustomer' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'UpdateCustomerInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'updateCustomer' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'firstName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'lastName' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UpdateCustomerMutation, UpdateCustomerMutationVariables>;
export const UpdatePasswordDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UpdatePassword' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'old' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'new' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'updateCustomerPassword' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'currentPassword' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'old' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'newPassword' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'new' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'Success' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UpdatePasswordMutation, UpdatePasswordMutationVariables>;
export const GetActiveOrderDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveOrder' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeOrder' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetActiveOrderQuery, GetActiveOrderQueryVariables>;
export const GetActiveOrderWithPriceDataDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveOrderWithPriceData' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeOrder' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'lines' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'unitPriceWithTax' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'taxRate' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'lineTax' } },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'linePriceWithTax' },
                                            },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'taxLines' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'taxRate' },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'description' },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'taxSummary' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'taxRate' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'taxBase' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'taxTotal' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetActiveOrderWithPriceDataQuery, GetActiveOrderWithPriceDataQueryVariables>;
export const AdjustItemQuantityDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'AdjustItemQuantity' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'orderLineId' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'quantity' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'adjustOrderLine' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'orderLineId' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'orderLineId' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'quantity' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'quantity' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'OrderInterceptorError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'interceptorError' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<AdjustItemQuantityMutation, AdjustItemQuantityMutationVariables>;
export const RemoveItemFromOrderDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'RemoveItemFromOrder' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'orderLineId' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'removeOrderLine' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'orderLineId' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'orderLineId' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'OrderInterceptorError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'interceptorError' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<RemoveItemFromOrderMutation, RemoveItemFromOrderMutationVariables>;
export const GetShippingMethodsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetShippingMethods' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'eligibleShippingMethods' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'price' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetShippingMethodsQuery, GetShippingMethodsQueryVariables>;
export const SetShippingMethodDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'SetShippingMethod' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: {
                            kind: 'ListType',
                            type: {
                                kind: 'NonNullType',
                                type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                            },
                        },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'setOrderShippingMethod' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'shippingMethodId' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<SetShippingMethodMutation, SetShippingMethodMutationVariables>;
export const SetCustomerForOrderDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'SetCustomerForOrder' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'CreateCustomerInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'setCustomerForOrder' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'ActiveOrderCustomer' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'GuestCheckoutError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorDetail' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'ActiveOrderCustomer' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'emailAddress' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'firstName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'lastName' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<SetCustomerForOrderMutation, SetCustomerForOrderMutationVariables>;
export const GetOrderByCodeDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetOrderByCode' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'orderByCode' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'code' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetOrderByCodeQuery, GetOrderByCodeQueryVariables>;
export const GetOrderShopDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetOrderShop' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'order' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetOrderShopQuery, GetOrderShopQueryVariables>;
export const GetOrderPromotionsByCodeDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetOrderPromotionsByCode' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'orderByCode' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'code' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'promotions' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetOrderPromotionsByCodeQuery, GetOrderPromotionsByCodeQueryVariables>;
export const GetAvailableCountriesDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetAvailableCountries' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'availableCountries' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetAvailableCountriesQuery, GetAvailableCountriesQueryVariables>;
export const TransitionToStateDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'TransitionToState' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'state' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'transitionOrderToState' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'state' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'state' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'OrderStateTransitionError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'transitionError' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'fromState' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'toState' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<TransitionToStateMutation, TransitionToStateMutationVariables>;
export const SetShippingAddressDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'SetShippingAddress' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'CreateAddressInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'setOrderShippingAddress' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'OrderWithAddresses' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'OrderWithAddresses' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'billingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<SetShippingAddressMutation, SetShippingAddressMutationVariables>;
export const SetBillingAddressDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'SetBillingAddress' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'CreateAddressInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'setOrderBillingAddress' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'OrderWithAddresses' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'OrderWithAddresses' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'billingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<SetBillingAddressMutation, SetBillingAddressMutationVariables>;
export const UnsetShippingAddressDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UnsetShippingAddress' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'unsetOrderShippingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'OrderWithAddresses' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'OrderWithAddresses' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'billingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UnsetShippingAddressMutation, UnsetShippingAddressMutationVariables>;
export const UnsetBillingAddressDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UnsetBillingAddress' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'unsetOrderBillingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'OrderWithAddresses' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'OrderWithAddresses' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'billingAddress' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'fullName' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'company' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine1' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'streetLine2' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'city' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'province' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'postalCode' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'country' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'phoneNumber' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UnsetBillingAddressMutation, UnsetBillingAddressMutationVariables>;
export const GetActiveOrderWithPaymentsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveOrderWithPayments' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeOrder' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderWithPayments' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderWithPayments' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'FragmentSpread', name: { kind: 'Name', value: 'TestOrderFragment' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'payments' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'transactionId' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'method' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'metadata' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetActiveOrderWithPaymentsQuery, GetActiveOrderWithPaymentsQueryVariables>;
export const AddPaymentToOrderDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'AddPaymentToOrder' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'PaymentInput' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'addPaymentToOrder' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderWithPayments' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'PaymentDeclinedError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'paymentErrorMessage' },
                                            },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'PaymentFailedError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'paymentErrorMessage' },
                                            },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'OrderStateTransitionError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'transitionError' },
                                            },
                                        ],
                                    },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'IneligiblePaymentMethodError' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'eligibilityCheckerMessage' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderWithPayments' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'FragmentSpread', name: { kind: 'Name', value: 'TestOrderFragment' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'payments' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'transactionId' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'method' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'metadata' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<AddPaymentToOrderMutation, AddPaymentToOrderMutationVariables>;
export const GetActiveOrderPaymentsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveOrderPayments' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeOrder' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'payments' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'transactionId' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'method' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorMessage' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'metadata' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetActiveOrderPaymentsQuery, GetActiveOrderPaymentsQueryVariables>;
export const GetOrderByCodeWithPaymentsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetOrderByCodeWithPayments' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'orderByCode' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'code' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'code' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderWithPayments' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderWithPayments' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'FragmentSpread', name: { kind: 'Name', value: 'TestOrderFragment' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'payments' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'transactionId' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'method' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'metadata' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetOrderByCodeWithPaymentsQuery, GetOrderByCodeWithPaymentsQueryVariables>;
export const GetActiveCustomerOrderWithItemFulfillmentsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveCustomerOrderWithItemFulfillments' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeCustomer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'orders' },
                                    arguments: [
                                        {
                                            kind: 'Argument',
                                            name: { kind: 'Name', value: 'options' },
                                            value: {
                                                kind: 'ObjectValue',
                                                fields: [
                                                    {
                                                        kind: 'ObjectField',
                                                        name: { kind: 'Name', value: 'skip' },
                                                        value: { kind: 'IntValue', value: '0' },
                                                    },
                                                    {
                                                        kind: 'ObjectField',
                                                        name: { kind: 'Name', value: 'take' },
                                                        value: { kind: 'IntValue', value: '5' },
                                                    },
                                                    {
                                                        kind: 'ObjectField',
                                                        name: { kind: 'Name', value: 'sort' },
                                                        value: {
                                                            kind: 'ObjectValue',
                                                            fields: [
                                                                {
                                                                    kind: 'ObjectField',
                                                                    name: {
                                                                        kind: 'Name',
                                                                        value: 'createdAt',
                                                                    },
                                                                    value: {
                                                                        kind: 'EnumValue',
                                                                        value: 'DESC',
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                    },
                                                    {
                                                        kind: 'ObjectField',
                                                        name: { kind: 'Name', value: 'filter' },
                                                        value: {
                                                            kind: 'ObjectValue',
                                                            fields: [
                                                                {
                                                                    kind: 'ObjectField',
                                                                    name: { kind: 'Name', value: 'active' },
                                                                    value: {
                                                                        kind: 'ObjectValue',
                                                                        fields: [
                                                                            {
                                                                                kind: 'ObjectField',
                                                                                name: {
                                                                                    kind: 'Name',
                                                                                    value: 'eq',
                                                                                },
                                                                                value: {
                                                                                    kind: 'BooleanValue',
                                                                                    value: false,
                                                                                },
                                                                            },
                                                                        ],
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'totalItems' } },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'items' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'id' },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'code' },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'state' },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'lines' },
                                                            selectionSet: {
                                                                kind: 'SelectionSet',
                                                                selections: [
                                                                    {
                                                                        kind: 'Field',
                                                                        name: { kind: 'Name', value: 'id' },
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'fulfillments' },
                                                            selectionSet: {
                                                                kind: 'SelectionSet',
                                                                selections: [
                                                                    {
                                                                        kind: 'Field',
                                                                        name: { kind: 'Name', value: 'id' },
                                                                    },
                                                                    {
                                                                        kind: 'Field',
                                                                        name: {
                                                                            kind: 'Name',
                                                                            value: 'state',
                                                                        },
                                                                    },
                                                                    {
                                                                        kind: 'Field',
                                                                        name: {
                                                                            kind: 'Name',
                                                                            value: 'method',
                                                                        },
                                                                    },
                                                                    {
                                                                        kind: 'Field',
                                                                        name: {
                                                                            kind: 'Name',
                                                                            value: 'trackingCode',
                                                                        },
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<
    GetActiveCustomerOrderWithItemFulfillmentsQuery,
    GetActiveCustomerOrderWithItemFulfillmentsQueryVariables
>;
export const GetNextOrderStatesDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetNextOrderStates' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [{ kind: 'Field', name: { kind: 'Name', value: 'nextOrderStates' } }],
            },
        },
    ],
} as unknown as DocumentNode<GetNextOrderStatesQuery, GetNextOrderStatesQueryVariables>;
export const GetCustomerAddressesDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetCustomerAddresses' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeOrder' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'customer' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'addresses' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'id' },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'streetLine1' },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetCustomerAddressesQuery, GetCustomerAddressesQueryVariables>;
export const GetCustomerOrdersDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetCustomerOrders' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeOrder' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'customer' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'orders' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'items' },
                                                            selectionSet: {
                                                                kind: 'SelectionSet',
                                                                selections: [
                                                                    {
                                                                        kind: 'Field',
                                                                        name: { kind: 'Name', value: 'id' },
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetCustomerOrdersQuery, GetCustomerOrdersQueryVariables>;
export const GetActiveCustomerOrdersDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveCustomerOrders' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeCustomer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'orders' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'totalItems' } },
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'items' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'id' },
                                                        },
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'state' },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetActiveCustomerOrdersQuery, GetActiveCustomerOrdersQueryVariables>;
export const ApplyCouponCodeDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'ApplyCouponCode' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'couponCode' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'applyCouponCode' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'couponCode' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'couponCode' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<ApplyCouponCodeMutation, ApplyCouponCodeMutationVariables>;
export const RemoveCouponCodeDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'RemoveCouponCode' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'couponCode' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'removeCouponCode' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'couponCode' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'couponCode' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<RemoveCouponCodeMutation, RemoveCouponCodeMutationVariables>;
export const RemoveAllOrderLinesDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'RemoveAllOrderLines' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'removeAllOrderLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TestOrderFragment' },
                                },
                                {
                                    kind: 'InlineFragment',
                                    typeCondition: {
                                        kind: 'NamedType',
                                        name: { kind: 'Name', value: 'ErrorResult' },
                                    },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'errorCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'TestOrderFragment' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Order' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'state' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'active' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotal' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subTotalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shipping' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'shippingWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'totalWithTax' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'currencyCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'couponCodes' } },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'discounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'adjustmentSource' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'quantity' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'linePriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPrice' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceWithTax' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'unitPriceChangeSinceAdded' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'unitPriceWithTaxChangeSinceAdded' },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discountedUnitPriceWithTax' },
                                },
                                { kind: 'Field', name: { kind: 'Name', value: 'proratedUnitPriceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'productVariant' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'id' } }],
                                    },
                                },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'discounts' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'adjustmentSource' },
                                            },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amount' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'amountWithTax' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'shippingLines' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'priceWithTax' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'shippingMethod' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'customer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'user' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'identifier' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'history' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'items' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'type' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<RemoveAllOrderLinesMutation, RemoveAllOrderLinesMutationVariables>;
export const GetEligiblePaymentMethodsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetEligiblePaymentMethods' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'eligiblePaymentMethods' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'eligibilityMessage' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'isEligible' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetEligiblePaymentMethodsQuery, GetEligiblePaymentMethodsQueryVariables>;
export const GetProductStockLevelDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetProductStockLevel' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'product' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'variants' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'stockLevel' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetProductStockLevelQuery, GetProductStockLevelQueryVariables>;
export const GetActiveCustomerWithOrdersProductSlugDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveCustomerWithOrdersProductSlug' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'options' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'OrderListOptions' } },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeCustomer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'orders' },
                                    arguments: [
                                        {
                                            kind: 'Argument',
                                            name: { kind: 'Name', value: 'options' },
                                            value: {
                                                kind: 'Variable',
                                                name: { kind: 'Name', value: 'options' },
                                            },
                                        },
                                    ],
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'items' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'lines' },
                                                            selectionSet: {
                                                                kind: 'SelectionSet',
                                                                selections: [
                                                                    {
                                                                        kind: 'Field',
                                                                        name: {
                                                                            kind: 'Name',
                                                                            value: 'productVariant',
                                                                        },
                                                                        selectionSet: {
                                                                            kind: 'SelectionSet',
                                                                            selections: [
                                                                                {
                                                                                    kind: 'Field',
                                                                                    name: {
                                                                                        kind: 'Name',
                                                                                        value: 'product',
                                                                                    },
                                                                                    selectionSet: {
                                                                                        kind: 'SelectionSet',
                                                                                        selections: [
                                                                                            {
                                                                                                kind: 'Field',
                                                                                                name: {
                                                                                                    kind: 'Name',
                                                                                                    value: 'slug',
                                                                                                },
                                                                                            },
                                                                                        ],
                                                                                    },
                                                                                },
                                                                            ],
                                                                        },
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<
    GetActiveCustomerWithOrdersProductSlugQuery,
    GetActiveCustomerWithOrdersProductSlugQueryVariables
>;
export const GetActiveCustomerWithOrdersProductPriceDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveCustomerWithOrdersProductPrice' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'options' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'OrderListOptions' } },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeCustomer' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'orders' },
                                    arguments: [
                                        {
                                            kind: 'Argument',
                                            name: { kind: 'Name', value: 'options' },
                                            value: {
                                                kind: 'Variable',
                                                name: { kind: 'Name', value: 'options' },
                                            },
                                        },
                                    ],
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            {
                                                kind: 'Field',
                                                name: { kind: 'Name', value: 'items' },
                                                selectionSet: {
                                                    kind: 'SelectionSet',
                                                    selections: [
                                                        {
                                                            kind: 'Field',
                                                            name: { kind: 'Name', value: 'lines' },
                                                            selectionSet: {
                                                                kind: 'SelectionSet',
                                                                selections: [
                                                                    {
                                                                        kind: 'Field',
                                                                        name: {
                                                                            kind: 'Name',
                                                                            value: 'linePrice',
                                                                        },
                                                                    },
                                                                    {
                                                                        kind: 'Field',
                                                                        name: {
                                                                            kind: 'Name',
                                                                            value: 'productVariant',
                                                                        },
                                                                        selectionSet: {
                                                                            kind: 'SelectionSet',
                                                                            selections: [
                                                                                {
                                                                                    kind: 'Field',
                                                                                    name: {
                                                                                        kind: 'Name',
                                                                                        value: 'id',
                                                                                    },
                                                                                },
                                                                                {
                                                                                    kind: 'Field',
                                                                                    name: {
                                                                                        kind: 'Name',
                                                                                        value: 'name',
                                                                                    },
                                                                                },
                                                                                {
                                                                                    kind: 'Field',
                                                                                    name: {
                                                                                        kind: 'Name',
                                                                                        value: 'price',
                                                                                    },
                                                                                },
                                                                            ],
                                                                        },
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<
    GetActiveCustomerWithOrdersProductPriceQuery,
    GetActiveCustomerWithOrdersProductPriceQueryVariables
>;
export const ActivePaymentMethodsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'ActivePaymentMethods' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activePaymentMethods' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'translations' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'languageCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<ActivePaymentMethodsQuery, ActivePaymentMethodsQueryVariables>;
export const GetActiveShippingMethodsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'GetActiveShippingMethods' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'activeShippingMethods' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'code' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'translations' },
                                    selectionSet: {
                                        kind: 'SelectionSet',
                                        selections: [
                                            { kind: 'Field', name: { kind: 'Name', value: 'languageCode' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                                            { kind: 'Field', name: { kind: 'Name', value: 'description' } },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<GetActiveShippingMethodsQuery, GetActiveShippingMethodsQueryVariables>;
