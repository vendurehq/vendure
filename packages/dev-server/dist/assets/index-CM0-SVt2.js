import{g as o,j as e,T as m,x as a}from"./index-DS-sPk4K.js";import"./manage-languages-dialog-DMIV8kK5.js";import"./login-form-XkWZnAew.js";import"./channel-selector-KZGTkP46.js";import"./country-selector-DMOClY7e.js";import"./customer-address-form-DXKMq2Ds.js";import"./customer-selector-ZAf-OfIQ.js";import"./history-entry-extensions-IkEPnSAm.js";import"./language-selector-DALjaOXF.js";import"./product-variant-selector-BvbGC_AZ.js";import"./role-selector-bnOY8EIK.js";import"./seller-selector-DYzO0vtG.js";import"./tax-category-selector-DhIFAfdI.js";import"./zone-selector-MbfTg3uG.js";import"./sidebar-context-Csf5fQ1P.js";import"./common-operations-BBWt2XKb.js";import"./use-job-queue-polling-De1oK9Hb.js";import{L as n}from"./list-page-C1zv4VUn.js";import"./eye-DeeDgiHt.js";import"./form-field-wrapper-CeFnam_I.js";const p=o(`
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
