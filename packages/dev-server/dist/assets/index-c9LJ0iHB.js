import{j as e,T as s,g as o,d,x as l,U as c}from"./index-CLu5rDeH.js";import"./manage-languages-dialog-D3tHny2v.js";import"./login-form-VtewDOPE.js";import"./channel-selector-Do71C5iP.js";import"./country-selector-h-e_Ka-a.js";import"./customer-address-form-CO2bcYln.js";import"./customer-selector-BblJHoFu.js";import"./history-entry-extensions-CCc0gJIO.js";import"./language-selector-Bpk7vIdY.js";import"./product-variant-selector-C-0EHN8s.js";import"./role-selector-BcF8qOU2.js";import"./seller-selector-QyJvWefQ.js";import"./tax-category-selector-BKe6cg7e.js";import"./zone-selector-Cln0FRnB.js";import"./sidebar-context-CGjDdael.js";import"./common-operations-D6p_g75R.js";import"./use-job-queue-polling-BOPXRdBV.js";import{L as a}from"./labeled-data-DuzdsM3Q.js";import{D as u}from"./detail-page-button-CID9nA93.js";import{D as m}from"./detail-page-DLTijzbS.js";import{L as g}from"./list-page-LZguKtGs.js";import"./eye-DTEjTqkd.js";import"./form-field-wrapper-BQHMwvwT.js";const y={id:"group-buy-info",title:e.jsx(s,{id:"CNhe1i"}),location:{pageId:"order-detail",column:"side",position:{blockId:"logistics-tracking",order:"after"}},shouldRender:i=>!!i.entity?.customFields?.groupBuyActivityId,component:({context:i})=>{const r=i.entity?.customFields;return r?.groupBuyActivityId?e.jsxs("div",{className:"space-y-2",children:[e.jsx(a,{label:"Activity ID",children:e.jsx(u,{href:`/group-buy-activities/${r.groupBuyActivityId}`,label:String(r.groupBuyActivityId)})}),e.jsx(a,{label:"Is Leader",children:e.jsx("span",{className:`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.groupBuyIsLeader?"bg-amber-100 text-amber-800":"bg-gray-100 text-gray-800"}`,children:r.groupBuyIsLeader?"Leader":"Member"})})]}):null}},n=o(`
    query GetGroupBuyDetail($id: ID!) {
        groupBuyActivity(id: $id) {
            id
            name
            description
            targetCount
            currentCount
            maxCount
            status
            startAt
            endAt
            groupPrice
            leaderDiscount
            leaderRewardType
            autoConfirm
            allowJoinAfterComplete
            createdAt
            updatedAt
        }
    }
`),x=o(`
    mutation CreateGroupBuyActivity($input: CreateGroupBuyActivityInput!) {
        createGroupBuyActivity(input: $input) {
            id
        }
    }
`),b=o(`
    mutation UpdateGroupBuyActivity($input: UpdateGroupBuyActivityInput!) {
        updateGroupBuyActivity(input: $input) {
            id
        }
    }
`),B={path:"/group-buy-activities/$id",loader:d({queryDocument:n,breadcrumb:(i,t)=>[{path:"/group-buy-activities",label:"Group Buy"},i?"New":t?.name]}),component:i=>e.jsx(m,{pageId:"group-buy-detail",queryDocument:n,createDocument:x,updateDocument:b,route:i,title:t=>t.name,setValuesForUpdate:t=>({id:t.id,name:t.name,description:t.description,targetCount:t.targetCount,maxCount:t.maxCount,startAt:t.startAt,endAt:t.endAt,groupPrice:t.groupPrice,leaderDiscount:t.leaderDiscount,status:t.status})})},A=o(`
    query GetGroupBuyActivities($options: Json) {
        groupBuyActivities(options: $options) {
            items {
                id
                name
                status
                targetCount
                currentCount
                maxCount
                groupPrice
                startAt
                endAt
            }
            totalItems
        }
    }
`),f={navMenuItem:{sectionId:"marketing",id:"group-buy-activities",url:"/group-buy-activities",title:"Group Buy",requiresPermission:["ReadPromotion"]},path:"/group-buy-activities",loader:()=>({breadcrumb:"Group Buy"}),component:i=>e.jsx(g,{pageId:"group-buy-list",title:e.jsx(s,{id:"XmTq2m"}),listQuery:A,route:i,defaultVisibility:{maxCount:!1,groupPrice:!1},customizeColumns:{id:{header:"ID",cell:({row:t})=>e.jsx(u,{id:t.original.id,label:t.original.id})},name:{header:"Name",cell:({row:t})=>e.jsx(u,{id:t.original.id,label:t.original.name})},status:{header:"Status",cell:({row:t})=>{const r=t.original.status,p={active:"bg-green-100 text-green-800",completed:"bg-blue-100 text-blue-800",expired:"bg-gray-100 text-gray-800"};return e.jsx("span",{className:`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p[r]||""}`,children:r})}}}})};l({navSections:[{id:"marketing",title:"Marketing",icon:c,order:600}],routes:[f,B],pageBlocks:[y]});
