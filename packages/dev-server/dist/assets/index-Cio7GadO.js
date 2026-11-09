import{g as o,j as e,T as m,x as a}from"./index-BEWB-Tpc.js";import"./manage-languages-dialog-DHH1CX1B.js";import"./login-form--sKT3uaa.js";import"./channel-selector-CjlI3I-E.js";import"./country-selector-CrUSS7-U.js";import"./customer-address-form-xPoHsKeW.js";import"./customer-selector-BwblO224.js";import"./history-entry-extensions-BN58gOF7.js";import"./language-selector-DcnAQ26p.js";import"./product-variant-selector-Cm9RuJrE.js";import"./role-selector-y8H1yH-z.js";import"./seller-selector-DVIOdKp7.js";import"./tax-category-selector-CY-uoW2p.js";import"./zone-selector-CVjynmwB.js";import"./sidebar-context-Jw8BEXxL.js";import"./common-operations-MAx-dweV.js";import"./use-job-queue-polling-AYm6bnNF.js";import{L as n}from"./list-page-B2i9jzml.js";import"./eye-LjRQVh9Q.js";import"./form-field-wrapper-Cvabj0WC.js";const p=o(`
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
