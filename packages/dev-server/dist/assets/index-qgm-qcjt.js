import{g as o,j as e,T as m,x as a}from"./index-C9uJSeZM.js";import"./manage-languages-dialog-BZpyb5IR.js";import"./login-form-BqkaVTVI.js";import"./channel-selector-BrTFsSZP.js";import"./country-selector-CxKHb_vN.js";import"./customer-address-form-D8EaylxM.js";import"./customer-selector-B37lHDJN.js";import"./history-entry-extensions-DuuuW_FL.js";import"./language-selector-CsotLSor.js";import"./product-variant-selector-Dx7ialx8.js";import"./role-selector-BbaW5FIS.js";import"./seller-selector-CRxyztPd.js";import"./tax-category-selector-uEGWnYvU.js";import"./zone-selector-CJa6z510.js";import"./sidebar-context-DuNqAWvK.js";import"./common-operations-B-iK7uIP.js";import"./use-job-queue-polling-BlTivCm8.js";import{L as n}from"./list-page-btZdDSaA.js";import"./eye-BPAUsnxZ.js";import"./form-field-wrapper-CsEDND_x.js";const p=o(`
    query GetSubscribeMessageLogs {
        subscribeMessageLogs {
            items {
                id
                customerId
                openid
                templateId
                status
                errorMsg
                sentAt
                createdAt
            }
            totalItems
        }
    }
`),g={navMenuItem:{sectionId:"marketing",id:"subscribe-message-logs",url:"/subscribe-message-logs",title:"订阅消息日志",requiresPermission:["ReadSettings"]},path:"/subscribe-message-logs",loader:()=>({breadcrumb:"订阅消息日志"}),component:t=>e.jsx(n,{pageId:"subscribe-message-log-list",title:e.jsx(m,{id:"cF8ysM"}),listQuery:p,route:t,customizeColumns:{status:{header:"状态",cell:({row:r})=>{const s=r.original.status,i={success:"bg-green-100 text-green-800",failed:"bg-red-100 text-red-800",pending:"bg-yellow-100 text-yellow-800"};return e.jsx("span",{className:`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${i[s]||""}`,children:s})}}}})};a({routes:[g]});
