export const onebridgeEnums = /* GraphQL */ `
    enum NeedType {
        logistics
        daily
        collections
        projects
    }

    enum BusinessLine {
        net
        pond
        hook
    }

    enum Locale {
        ko
        zh
    }

    enum CrossBorderStage {
        lost
        wait_pay
        quoting
        requirement
        sourcing
        risk
        sample
        producing
        shipping
        qc
        refund
        delivered
        customs
        done
    }

    enum StageEventState {
        done
        now
        todo
    }

    enum ContentType {
        column
        case
        logistics_channel
        site_block
    }

    enum CustomsStatus {
        not_started
        docs_preparing
        declared
        inspecting
        cleared
        hold
    }

    enum InspectionResult {
        pass
        fail
        conditional
    }
`;

const rfqTypes = /* GraphQL */ `
    type RfqCustomer {
        name: String!
        contact: String!
        locale: Locale!
        customerId: ID
    }

    type RfqRequirement {
        item: String!
        qty: String
        eta: String
        memo: String
    }

    type RfqQuote {
        amount: Int!
        currency: CurrencyCode!
        validUntil: DateTime
        note: String
        createdAt: DateTime!
    }

    type RfqSample {
        status: String!
        trackingNo: String
        confirmedAt: DateTime
    }

    type StageEvent {
        stage: CrossBorderStage!
        title: String!
        desc: String
        state: StageEventState!
        time: DateTime
    }

    type Rfq implements Node {
        id: ID!
        code: String!
        channelToken: String!
        needType: NeedType!
        needLabel: String!
        customerName: String!
        customerContact: String!
        customer: RfqCustomer!
        requirement: RfqRequirement!
        stage: CrossBorderStage!
        businessLine: BusinessLine
        assignedTeam: String
        quote: RfqQuote
        sample: RfqSample
        timeline: [StageEvent!]!
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type RfqList implements PaginatedList {
        items: [Rfq!]!
        totalItems: Int!
    }

    type InspectionReport implements Node {
        id: ID!
        code: String!
        orderCode: String
        rfqCode: String
        inspector: String!
        inspectedAt: DateTime!
        result: InspectionResult!
        photos: [String!]
        notesKr: String
        notesCn: String
        passed: Boolean!
        publishedAt: DateTime
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type CustomsRecord implements Node {
        id: ID!
        orderCode: String!
        customsStatus: CustomsStatus!
        declaredAt: DateTime
        clearedAt: DateTime
        hsCode: String
        declarationNo: String
        note: String
        docs: [String!]
        # 与 C 端 CT-09 查询字段名对齐（同一存储的对外别名，见 05 号文档）
        customsDeclaredAt: DateTime
        customsClearedAt: DateTime
        customsNote: String
        customsDocs: [String!]
        timeline: [StageEvent!]!
        lastSyncedAt: DateTime
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type OnebridgeOrderItem {
        id: ID!
        productVariantId: ID
        name: String!
        spec: String
        qty: Int!
        # 行小计（含税）= 下单时 linePriceWithTax，语义保持不变
        price: Int!
        # 新增：单价（含税）= 下单时 unitPriceWithTax；与 price 同为最小货币单位（precision=2）
        unitPrice: Int!
    }

    type OnebridgeOrderSummary {
        code: String!
        state: String!
        totalWithTax: Int!
        currencyCode: CurrencyCode!
        businessLine: BusinessLine
        crossBorderStage: CrossBorderStage
        rfqCode: String
        needType: NeedType
        krwAmount: Int
        expectedEta: DateTime
        createdAt: DateTime!
        updatedAt: DateTime!
        items: [OnebridgeOrderItem!]!
        timeline: [StageEvent!]!
    }

    input SubmitRfqInput {
        need: NeedType!
        name: String!
        contact: String!
        item: String!
        qty: String
        eta: String
        memo: String
        locale: Locale
        idempotencyKey: String
    }

    input RfqListOptions {
        skip: Int
        take: Int
        needType: NeedType
        stage: CrossBorderStage
        keyword: String
    }

    input ContentQueryOptions {
        needType: NeedType
        take: Int
    }

    type ServiceChannel {
        needType: String
        nameKr: String
        nameCn: String
        nameEn: String
        tag: String
        audience: String
        headlineKr: String
        headlineCn: String
        introKr: String
        introCn: String
        color: String
        points: JSON
        # C 端字段别名（CT-09 serviceChannels 查询）
        key: String
        no: String
        kr: String
        cn: String
        en: String
        headline: String
        intro: String
    }

    type OnebridgeOrderTrack {
        orderCode: String!
        fulfillmentId: ID
        trackingNo: String
        carrierCode: String
        carrierName: String
        status: String!
        trackInfo: [StageEvent!]!
        signedAt: DateTime
        lastSyncedAt: DateTime
        channelId: ID
    }
`;

const contentShopType = /* GraphQL */ `
    type OnebridgeContent {
        id: ID!
        slug: String!
        contentType: ContentType!
        # C 端字段别名：type / krTitle / cnTitle / en / points（CT-09 columns/cases/logisticsChannels）
        type: ContentType!
        krTitle: String!
        cnTitle: String
        en: String
        points: JSON
        needType: NeedType
        title(locale: Locale = ko): String!
        body(locale: Locale = ko): String
        titleKr: String!
        titleCn: String
        titleEn: String
        bodyKr: String
        bodyCn: String
        bodyEn: String
        who: String
        caseResult: String
        eta: String
        tag: String
        color: String
        images: [String!]
        payload: JSON
        sort: Int!
        published: Boolean!
        publishedAt: DateTime
    }
`;

/** CT-09 specSheets：字段为 Product customFields + 首个变体 priceWithTax 的投影（零 DDL）。 */
const specSheetType = /* GraphQL */ `
    type SpecSheet {
        slug: String!
        krName: String!
        spec: String!
        moq: Int
        leadTime: String!
        price: Int
    }
`;

export const onebridgeShopTypeDefs = /* GraphQL */ `
    ${onebridgeEnums}
    ${rfqTypes}
    ${contentShopType}
    ${specSheetType}

    extend type Query {
        myRfqs(options: RfqListOptions): RfqList!
        rfq(code: String!): Rfq
        # locale 仅为 C 端查询变量对齐而接收（文案由 title/body 的 locale 参数决定）
        columns(locale: Locale, options: ContentQueryOptions): [OnebridgeContent!]!
        column(slug: String!): OnebridgeContent
        cases(locale: Locale, options: ContentQueryOptions): [OnebridgeContent!]!
        case(slug: String!): OnebridgeContent
        logisticsChannels(locale: Locale, options: ContentQueryOptions): [OnebridgeContent!]!
        logisticsChannel(slug: String!): OnebridgeContent
        siteContent(locale: Locale, options: ContentQueryOptions): [OnebridgeContent!]!
        serviceChannels(locale: Locale): [ServiceChannel!]!
        specSheets(take: Int): [SpecSheet!]!
        inspectionReports(orderCode: String, rfqCode: String): [InspectionReport!]!
        orderCustoms(orderCode: String!): CustomsRecord
        orderTimeline(orderCode: String!): [StageEvent!]!
        orderTracks(orderCode: String!): OnebridgeOrderTrack
        orderSummary(orderCode: String!): OnebridgeOrderSummary!
    }

    extend type Mutation {
        submitRfq(input: SubmitRfqInput!): Rfq!
    }
`;

export const onebridgeAdminTypeDefs = /* GraphQL */ `
    ${onebridgeEnums}
    ${rfqTypes}
    ${specSheetType}

    type OnebridgeContentEntry implements Node {
        id: ID!
        channelToken: String!
        slug: String!
        contentType: ContentType!
        needType: NeedType
        titleKr: String!
        titleCn: String
        titleEn: String
        bodyKr: String
        bodyCn: String
        bodyEn: String
        who: String
        caseResult: String
        eta: String
        tag: String
        color: String
        images: [String!]
        payload: JSON
        sort: Int!
        published: Boolean!
        publishedAt: DateTime
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type OnebridgeContentList implements PaginatedList {
        items: [OnebridgeContentEntry!]!
        totalItems: Int!
    }

    type InspectionList implements PaginatedList {
        items: [InspectionReport!]!
        totalItems: Int!
    }

    type CustomsList implements PaginatedList {
        items: [CustomsRecord!]!
        totalItems: Int!
    }

    input RfqQuoteInput {
        amount: Int!
        currency: CurrencyCode
        validUntil: DateTime
        note: String
    }

    input RfqSampleInput {
        status: String!
        trackingNo: String
        confirmedAt: DateTime
    }

    input ContentListOptions {
        skip: Int
        take: Int
        contentType: ContentType
        needType: NeedType
        published: Boolean
        keyword: String
        # Dashboard ListPage 固定传 sort/filter，服务端暂不消费
        sort: JSON
        filter: JSON
        filterOperator: LogicalOperator
    }

    input OnebridgeContentInput {
        id: ID
        contentType: ContentType!
        slug: String!
        needType: NeedType
        titleKr: String!
        titleCn: String
        titleEn: String
        bodyKr: String
        bodyCn: String
        bodyEn: String
        who: String
        caseResult: String
        eta: String
        tag: String
        color: String
        images: [String!]
        payload: JSON
        sort: Int
        published: Boolean
    }

    input InspectionListOptions {
        skip: Int
        take: Int
        orderCode: String
        rfqCode: String
        result: InspectionResult
        published: Boolean
        # Dashboard ListPage 固定传 sort/filter，服务端暂不消费
        sort: JSON
        filter: JSON
        filterOperator: LogicalOperator
    }

    input InspectionReportInput {
        orderCode: String
        rfqCode: String
        inspector: String!
        inspectedAt: DateTime
        result: InspectionResult!
        photos: [String!]
        notesKr: String
        notesCn: String
        passed: Boolean
    }

    input CustomsListOptions {
        skip: Int
        take: Int
        customsStatus: CustomsStatus
        keyword: String
        # Dashboard ListPage 固定传 sort/filter，服务端暂不消费
        sort: JSON
        filter: JSON
        filterOperator: LogicalOperator
    }

    input CustomsRecordInput {
        orderCode: String!
        customsStatus: CustomsStatus
        declaredAt: DateTime
        clearedAt: DateTime
        hsCode: String
        declarationNo: String
        note: String
        docs: [String!]
        idempotencyKey: String
    }

    extend type Query {
        onebridgeRfqs(options: RfqListOptions): RfqList!
        onebridgeRfq(id: ID, code: String): Rfq
        onebridgeContentEntries(options: ContentListOptions): OnebridgeContentList!
        onebridgeInspectionReports(options: InspectionListOptions): InspectionList!
        onebridgeCustomsRecord(orderCode: String!): CustomsRecord
        onebridgeCustomsRecords(options: CustomsListOptions): CustomsList!
        onebridgeOrderSummary(orderCode: String!): OnebridgeOrderSummary!
        onebridgeSpecSheets(take: Int): [SpecSheet!]!
    }

    extend type Mutation {
        saveRfqQuote(rfqId: ID!, input: RfqQuoteInput!): RfqQuote!
        saveRfqSample(rfqId: ID!, input: RfqSampleInput!): RfqSample!
        transitionRfqStage(
            rfqId: ID!
            stage: CrossBorderStage!
            title: String
            desc: String
            idempotencyKey: String
        ): Rfq!
        saveOnebridgeContentEntry(input: OnebridgeContentInput!): OnebridgeContentEntry!
        deleteOnebridgeContentEntry(id: ID!): Boolean!
        createOnebridgeInspectionReport(input: InspectionReportInput!): InspectionReport!
        publishOnebridgeInspectionReport(id: ID!): InspectionReport!
        upsertOnebridgeCustomsRecord(input: CustomsRecordInput!): CustomsRecord!
    }
`;
