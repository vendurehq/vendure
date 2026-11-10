import{g as n,u as a,a as c,j as r,T as d,x as p}from"./index-BcOoJppr.js";import"./manage-languages-dialog-vxwm_3Rz.js";import"./login-form-B_F-5zTI.js";import"./channel-selector-DU961I5x.js";import"./country-selector-55Xe5yyb.js";import"./customer-address-form-C0-vebuL.js";import"./customer-selector-Es2yzNl_.js";import"./history-entry-extensions-DBzSOQ9X.js";import"./language-selector-CMk9Rgel.js";import"./product-variant-selector-y2J54kg_.js";import"./role-selector-taykVS-z.js";import"./seller-selector-DLLBgaHb.js";import"./tax-category-selector-BtHVVe2w.js";import"./zone-selector-vuMpw-Oi.js";import"./sidebar-context-CzHTwxQO.js";import"./common-operations-BdzNkZJM.js";import"./use-job-queue-polling-BNFB1agE.js";import{L as t}from"./labeled-data-CpAx7Ly8.js";import"./eye-D4Nkaf3R.js";import"./form-field-wrapper-T-_M8wYL.js";const u=n(`
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
