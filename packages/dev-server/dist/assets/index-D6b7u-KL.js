import{g as o,j as e,T as m,x as a}from"./index-CLu5rDeH.js";import"./manage-languages-dialog-D3tHny2v.js";import"./login-form-VtewDOPE.js";import"./channel-selector-Do71C5iP.js";import"./country-selector-h-e_Ka-a.js";import"./customer-address-form-CO2bcYln.js";import"./customer-selector-BblJHoFu.js";import"./history-entry-extensions-CCc0gJIO.js";import"./language-selector-Bpk7vIdY.js";import"./product-variant-selector-C-0EHN8s.js";import"./role-selector-BcF8qOU2.js";import"./seller-selector-QyJvWefQ.js";import"./tax-category-selector-BKe6cg7e.js";import"./zone-selector-Cln0FRnB.js";import"./sidebar-context-CGjDdael.js";import"./common-operations-D6p_g75R.js";import"./use-job-queue-polling-BOPXRdBV.js";import{L as n}from"./list-page-LZguKtGs.js";import"./eye-DTEjTqkd.js";import"./form-field-wrapper-BQHMwvwT.js";const p=o(`
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
