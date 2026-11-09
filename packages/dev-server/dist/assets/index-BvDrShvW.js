import{g as n,u as a,a as c,j as r,T as d,x as p}from"./index-BEWB-Tpc.js";import"./manage-languages-dialog-DHH1CX1B.js";import"./login-form--sKT3uaa.js";import"./channel-selector-CjlI3I-E.js";import"./country-selector-CrUSS7-U.js";import"./customer-address-form-xPoHsKeW.js";import"./customer-selector-BwblO224.js";import"./history-entry-extensions-BN58gOF7.js";import"./language-selector-DcnAQ26p.js";import"./product-variant-selector-Cm9RuJrE.js";import"./role-selector-y8H1yH-z.js";import"./seller-selector-DVIOdKp7.js";import"./tax-category-selector-CY-uoW2p.js";import"./zone-selector-CVjynmwB.js";import"./sidebar-context-Jw8BEXxL.js";import"./common-operations-MAx-dweV.js";import"./use-job-queue-polling-AYm6bnNF.js";import{L as t}from"./labeled-data-x_b-VMwM.js";import"./eye-LjRQVh9Q.js";import"./form-field-wrapper-Cvabj0WC.js";const u=n(`
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
