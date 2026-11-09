import{g as n,u as a,a as c,j as r,T as d,x as p}from"./index-CLu5rDeH.js";import"./manage-languages-dialog-D3tHny2v.js";import"./login-form-VtewDOPE.js";import"./channel-selector-Do71C5iP.js";import"./country-selector-h-e_Ka-a.js";import"./customer-address-form-CO2bcYln.js";import"./customer-selector-BblJHoFu.js";import"./history-entry-extensions-CCc0gJIO.js";import"./language-selector-Bpk7vIdY.js";import"./product-variant-selector-C-0EHN8s.js";import"./role-selector-BcF8qOU2.js";import"./seller-selector-QyJvWefQ.js";import"./tax-category-selector-BKe6cg7e.js";import"./zone-selector-Cln0FRnB.js";import"./sidebar-context-CGjDdael.js";import"./common-operations-D6p_g75R.js";import"./use-job-queue-polling-BOPXRdBV.js";import{L as t}from"./labeled-data-DuzdsM3Q.js";import"./eye-DTEjTqkd.js";import"./form-field-wrapper-BQHMwvwT.js";const u=n(`
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
