import{g as n,u as a,a as c,j as r,T as d,x as p}from"./index-C9uJSeZM.js";import"./manage-languages-dialog-BZpyb5IR.js";import"./login-form-BqkaVTVI.js";import"./channel-selector-BrTFsSZP.js";import"./country-selector-CxKHb_vN.js";import"./customer-address-form-D8EaylxM.js";import"./customer-selector-B37lHDJN.js";import"./history-entry-extensions-DuuuW_FL.js";import"./language-selector-CsotLSor.js";import"./product-variant-selector-Dx7ialx8.js";import"./role-selector-BbaW5FIS.js";import"./seller-selector-CRxyztPd.js";import"./tax-category-selector-uEGWnYvU.js";import"./zone-selector-CJa6z510.js";import"./sidebar-context-DuNqAWvK.js";import"./common-operations-B-iK7uIP.js";import"./use-job-queue-polling-BlTivCm8.js";import{L as t}from"./labeled-data-C7ud4wqw.js";import"./eye-BPAUsnxZ.js";import"./form-field-wrapper-CsEDND_x.js";const u=n(`
    query GetMemberInfo($customerId: ID!) {
        memberInfo(customerId: $customerId) {
            level
            levelName
            growthValue
            points
            nextLevelThreshold
            nextLevelName
        }
    }
`),x={id:"member-info",title:r.jsx(d,{id:"8f39x/"}),location:{pageId:"customer-detail",column:"side",position:{blockId:"customer-stats",order:"after"}},shouldRender:o=>!!o.entity?.customFields?.memberLevel,component:({context:o})=>{const m=o.entity?.id,{data:l,isLoading:i}=a({queryKey:["memberInfo",m],queryFn:()=>c.query(u,{customerId:m}),enabled:!!m});if(i)return r.jsx("div",{className:"text-sm text-gray-500",children:"加载中..."});const e=l?.memberInfo;return e?r.jsxs("div",{className:"space-y-2",children:[r.jsx(t,{label:"等级",children:e.level}),r.jsx(t,{label:"等级名称",children:e.levelName}),r.jsx(t,{label:"成长值",children:e.growthValue}),r.jsx(t,{label:"积分",children:e.points}),e.nextLevelThreshold!=null&&r.jsx(t,{label:"下一等级门槛",children:e.nextLevelThreshold}),e.nextLevelName&&r.jsx(t,{label:"下一等级名称",children:e.nextLevelName})]}):null}};p({pageBlocks:[x]});
