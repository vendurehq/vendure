import{g as c,o as N,r as C,u as K,a as x,p as y,t as m,j as e,P as q,e as I,i as $,k as h,O as b,B as j,h as R,q as k,s as v,x as E}from"./index-DS-sPk4K.js";import"./manage-languages-dialog-DMIV8kK5.js";import"./login-form-XkWZnAew.js";import"./channel-selector-KZGTkP46.js";import"./country-selector-DMOClY7e.js";import"./customer-address-form-DXKMq2Ds.js";import"./customer-selector-ZAf-OfIQ.js";import"./history-entry-extensions-IkEPnSAm.js";import"./language-selector-DALjaOXF.js";import"./product-variant-selector-BvbGC_AZ.js";import"./role-selector-bnOY8EIK.js";import"./seller-selector-DYzO0vtG.js";import"./tax-category-selector-DhIFAfdI.js";import"./zone-selector-MbfTg3uG.js";import"./sidebar-context-Csf5fQ1P.js";import"./common-operations-BBWt2XKb.js";import"./use-job-queue-polling-De1oK9Hb.js";import{L as S}from"./list-page-C1zv4VUn.js";import"./eye-DeeDgiHt.js";import"./form-field-wrapper-CeFnam_I.js";const Q=c(`
    query OnebridgeContentDetail($options: ContentListOptions) {
        onebridgeContentEntries(options: $options) {
            items {
                id
                slug
                contentType
                needType
                titleKr
                titleCn
                bodyKr
                bodyCn
                published
                sort
            }
        }
    }
`),F=c(`
    mutation SaveOnebridgeContent($input: OnebridgeContentInput!) {
        saveOnebridgeContentEntry(input: $input) {
            id
            slug
        }
    }
`),M=["column","case","logistics_channel","site_block"],w=["logistics","daily","collections","projects"];function _({route:t}){const{id:r}=t.useParams(),p=r==="new",o=N(),[s,l]=C.useState({contentType:"site_block",slug:"",needType:"",titleKr:"",titleCn:"",bodyKr:"",bodyCn:"",published:!1,sort:0});K({queryKey:["onebridge-content-detail",r],enabled:!p,queryFn:async()=>{const n=await x.query(Q,{options:{take:100}}),i=n.onebridgeContentEntries.items.find(f=>String(f.id)===String(r));return i&&l({...i,needType:i.needType??""}),n}});const g=y({mutationFn:()=>x.mutate(F,{input:{...p?{}:{id:r},contentType:s.contentType,slug:s.slug,needType:s.needType||null,titleKr:s.titleKr,titleCn:s.titleCn||null,bodyKr:s.bodyKr||null,bodyCn:s.bodyCn||null,published:!!s.published,sort:Number(s.sort??0)}}),onSuccess:()=>{m.success("内容已保存"),o.invalidateQueries({queryKey:["onebridge-content-list"]})},onError:n=>m.error(`保存失败: ${n.message}`)}),u=(n,i)=>l(f=>({...f,[n]:i}));return e.jsxs(q,{pageId:"onebridge-content-detail",children:[e.jsx(I,{children:p?"新建内容":`内容 #${r}`}),e.jsx($,{children:e.jsx(h,{column:"main",blockId:"onebridge-content-form",children:e.jsx(b,{children:e.jsxs("div",{className:"grid grid-cols-2 gap-3 p-4 text-sm",children:[e.jsxs("label",{className:"flex flex-col gap-1",children:["类型",e.jsx("select",{className:"border rounded px-2 py-1",value:s.contentType,onChange:n=>u("contentType",n.target.value),children:M.map(n=>e.jsx("option",{value:n,children:n},n))})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["归属",e.jsxs("select",{className:"border rounded px-2 py-1",value:s.needType,onChange:n=>u("needType",n.target.value),children:[e.jsx("option",{value:"",children:"无"}),w.map(n=>e.jsx("option",{value:n,children:n},n))]})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["标识 slug",e.jsx("input",{className:"border rounded px-2 py-1",value:s.slug,onChange:n=>u("slug",n.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["排序",e.jsx("input",{className:"border rounded px-2 py-1",type:"number",value:s.sort,onChange:n=>u("sort",n.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1 col-span-2",children:["韩文标题（待补，勿自造）",e.jsx("input",{className:"border rounded px-2 py-1",value:s.titleKr,onChange:n=>u("titleKr",n.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1 col-span-2",children:["中文标题",e.jsx("input",{className:"border rounded px-2 py-1",value:s.titleCn,onChange:n=>u("titleCn",n.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1 col-span-2",children:["韩文正文（待补）",e.jsx("textarea",{className:"border rounded px-2 py-1",rows:3,value:s.bodyKr,onChange:n=>u("bodyKr",n.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1 col-span-2",children:["中文正文",e.jsx("textarea",{className:"border rounded px-2 py-1",rows:3,value:s.bodyCn,onChange:n=>u("bodyCn",n.target.value)})]}),e.jsxs("label",{className:"flex items-center gap-2 col-span-2",children:[e.jsx("input",{type:"checkbox",checked:!!s.published,onChange:n=>u("published",n.target.checked)}),"发布"]}),e.jsx("div",{className:"col-span-2",children:e.jsx(j,{onClick:()=>g.mutate(),disabled:!s.slug||!s.titleKr,children:"保存"})})]})})})})]})}const z=c(`
    query OnebridgeContentList($options: ContentListOptions) {
        onebridgeContentEntries(options: $options) {
            totalItems
            items {
                id
                slug
                contentType
                needType
                titleKr
                titleCn
                published
                sort
                updatedAt
            }
        }
    }
`);function B({route:t}){return e.jsx(S,{pageId:"onebridge-content-list",title:"跨境内容",listQuery:z,route:t,customizeColumns:{slug:{header:"标识",cell:({row:r})=>e.jsx(v,{to:`/onebridge/content/${r.original.id}`,children:r.original.slug})},contentType:{header:"类型"},needType:{header:"归属"},titleKr:{header:"韩文标题（可能待补）"},titleCn:{header:"中文标题"},published:{header:"已发布"},sort:{header:"排序"}},children:e.jsx(R,{children:e.jsxs(j,{render:e.jsx(v,{to:"/onebridge/content/new"}),children:[e.jsx(k,{className:"mr-1 h-4 w-4"})," 新建"]})})})}const U=c(`
    query OnebridgeCustomsDetail($orderCode: String!) {
        onebridgeCustomsRecord(orderCode: $orderCode) {
            id
            orderCode
            customsStatus
            declaredAt
            clearedAt
            declarationNo
            hsCode
            note
            docs
            lastSyncedAt
        }
    }
`),W=c(`
    mutation UpsertOnebridgeCustoms($input: CustomsRecordInput!) {
        upsertOnebridgeCustomsRecord(input: $input) {
            id
            orderCode
            customsStatus
        }
    }
`),Y=["not_started","docs_preparing","declared","inspecting","cleared","hold"];function G({route:t}){const{orderCode:r}=t.useParams(),p=N(),[o,s]=C.useState({customsStatus:"docs_preparing",declarationNo:"",hsCode:"",note:"",idempotencyKey:""}),{data:l}=K({queryKey:["onebridge-customs",r],queryFn:()=>x.query(U,{orderCode:r})}),g=l?.onebridgeCustomsRecord,u=y({mutationFn:()=>x.mutate(W,{input:{orderCode:r,customsStatus:o.customsStatus,declarationNo:o.declarationNo||null,hsCode:o.hsCode||null,note:o.note||null,idempotencyKey:o.idempotencyKey||null}}),onSuccess:()=>{m.success("清关状态已回写"),p.invalidateQueries({queryKey:["onebridge-customs",r]}),s(i=>({...i,idempotencyKey:""}))},onError:i=>m.error(`回写失败: ${i.message}`)}),n=(i,f)=>s(O=>({...O,[i]:f}));return e.jsxs(q,{pageId:"onebridge-customs-detail",children:[e.jsxs(I,{children:["清关 · ",r]}),e.jsxs($,{children:[e.jsx(h,{column:"main",blockId:"onebridge-customs-current",children:e.jsx(b,{children:e.jsxs("div",{className:"grid grid-cols-2 gap-3 p-4 text-sm",children:[e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"当前状态"}),e.jsx("div",{children:g?.customsStatus??"未创建记录"})]}),e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"报关单号"}),e.jsx("div",{children:g?.declarationNo??"—"})]}),e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"申报时间"}),e.jsx("div",{children:g?.declaredAt??"—"})]}),e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"放行时间"}),e.jsx("div",{children:g?.clearedAt??"—"})]}),e.jsxs("div",{className:"col-span-2",children:[e.jsx("div",{className:"text-muted-foreground",children:"备注"}),e.jsx("div",{children:g?.note??"—"})]})]})})}),e.jsx(h,{column:"main",blockId:"onebridge-customs-upsert",children:e.jsx(b,{children:e.jsxs("div",{className:"grid grid-cols-2 gap-3 p-4 text-sm",children:[e.jsxs("label",{className:"flex flex-col gap-1",children:["回写状态",e.jsx("select",{className:"border rounded px-2 py-1",value:o.customsStatus,onChange:i=>n("customsStatus",i.target.value),children:Y.map(i=>e.jsx("option",{value:i,children:i},i))})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["HS Code",e.jsx("input",{className:"border rounded px-2 py-1",value:o.hsCode,onChange:i=>n("hsCode",i.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["报关单号",e.jsx("input",{className:"border rounded px-2 py-1",value:o.declarationNo,onChange:i=>n("declarationNo",i.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["幂等键（可选）",e.jsx("input",{className:"border rounded px-2 py-1",value:o.idempotencyKey,onChange:i=>n("idempotencyKey",i.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1 col-span-2",children:["备注",e.jsx("textarea",{className:"border rounded px-2 py-1",rows:2,value:o.note,onChange:i=>n("note",i.target.value)})]}),e.jsx("div",{className:"col-span-2",children:e.jsx(j,{onClick:()=>u.mutate(),children:"回写清关状态"})})]})})})]})]})}const H=c(`
    query OnebridgeCustomsList($options: CustomsListOptions) {
        onebridgeCustomsRecords(options: $options) {
            totalItems
            items {
                id
                orderCode
                customsStatus
                declaredAt
                clearedAt
                declarationNo
                hsCode
                lastSyncedAt
            }
        }
    }
`);function X({route:t}){return e.jsx(S,{pageId:"onebridge-customs-list",title:"跨境清关",listQuery:H,route:t,customizeColumns:{orderCode:{header:"订单号",cell:({row:r})=>e.jsx(v,{to:`/onebridge/customs/${r.original.orderCode}`,children:r.original.orderCode})},customsStatus:{header:"清关状态"},declarationNo:{header:"报关单号"},declaredAt:{header:"申报时间"},clearedAt:{header:"放行时间"},lastSyncedAt:{header:"最后同步"}}})}const J=c(`
    mutation CreateOnebridgeInspection($input: InspectionReportInput!) {
        createOnebridgeInspectionReport(input: $input) {
            id
            code
            publishedAt
        }
    }
`),V=c(`
    mutation PublishOnebridgeInspection($id: ID!) {
        publishOnebridgeInspectionReport(id: $id) {
            id
            publishedAt
        }
    }
`),Z=["pass","fail","conditional"];function ee(){const[t,r]=C.useState({orderCode:"",rfqCode:"",inspector:"",result:"pass",notesKr:"",notesCn:"",publish:!0}),p=y({mutationFn:async()=>{const l=(await x.mutate(J,{input:{orderCode:t.orderCode||null,rfqCode:t.rfqCode||null,inspector:t.inspector,result:t.result,notesKr:t.notesKr||null,notesCn:t.notesCn||null}})).createOnebridgeInspectionReport;return t.publish&&l?.id&&await x.mutate(V,{id:l.id}),l},onSuccess:s=>{m.success(`验货报告已创建: ${s?.code??""}`),r(l=>({...l,orderCode:"",rfqCode:"",notesKr:"",notesCn:""}))},onError:s=>m.error(`创建失败: ${s.message}`)}),o=(s,l)=>r(g=>({...g,[s]:l}));return e.jsxs(q,{pageId:"onebridge-inspection-create",children:[e.jsx(I,{children:"新建验货报告"}),e.jsx($,{children:e.jsx(h,{column:"main",blockId:"onebridge-inspection-form",children:e.jsx(b,{children:e.jsxs("div",{className:"grid grid-cols-2 gap-3 p-4 text-sm",children:[e.jsxs("label",{className:"flex flex-col gap-1",children:["订单号（与 RFQ 二选一）",e.jsx("input",{className:"border rounded px-2 py-1",value:t.orderCode,onChange:s=>o("orderCode",s.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["RFQ 受理号（与订单二选一）",e.jsx("input",{className:"border rounded px-2 py-1",value:t.rfqCode,onChange:s=>o("rfqCode",s.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["验货员",e.jsx("input",{className:"border rounded px-2 py-1",value:t.inspector,onChange:s=>o("inspector",s.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1",children:["结论",e.jsx("select",{className:"border rounded px-2 py-1",value:t.result,onChange:s=>o("result",s.target.value),children:Z.map(s=>e.jsx("option",{value:s,children:s},s))})]}),e.jsxs("label",{className:"flex flex-col gap-1 col-span-2",children:["韩文备注（待补，勿自造）",e.jsx("textarea",{className:"border rounded px-2 py-1",rows:2,value:t.notesKr,onChange:s=>o("notesKr",s.target.value)})]}),e.jsxs("label",{className:"flex flex-col gap-1 col-span-2",children:["中文备注",e.jsx("textarea",{className:"border rounded px-2 py-1",rows:2,value:t.notesCn,onChange:s=>o("notesCn",s.target.value)})]}),e.jsxs("label",{className:"flex items-center gap-2 col-span-2",children:[e.jsx("input",{type:"checkbox",checked:t.publish,onChange:s=>o("publish",s.target.checked)}),"创建后立即发布（Shop 可见）"]}),e.jsx("div",{className:"col-span-2",children:e.jsx(j,{onClick:()=>p.mutate(),disabled:!t.inspector||!t.orderCode&&!t.rfqCode,children:"创建报告"})})]})})})})]})}const se=c(`
    query OnebridgeInspectionList($options: InspectionListOptions) {
        onebridgeInspectionReports(options: $options) {
            totalItems
            items {
                id
                code
                orderCode
                rfqCode
                inspector
                result
                passed
                publishedAt
                inspectedAt
            }
        }
    }
`),te=c(`
    mutation PublishOnebridgeInspection($id: ID!) {
        publishOnebridgeInspectionReport(id: $id) {
            id
            publishedAt
        }
    }
`);function ne({route:t}){const r=N(),p=y({mutationFn:o=>x.mutate(te,{id:o}),onSuccess:()=>{m.success("验货报告已发布"),r.invalidateQueries()},onError:o=>m.error(`发布失败: ${o.message}`)});return e.jsx(S,{pageId:"onebridge-inspection-list",title:"跨境验货",listQuery:se,route:t,customizeColumns:{code:{header:"报告编号"},orderCode:{header:"订单"},rfqCode:{header:"RFQ"},inspector:{header:"验货员"},result:{header:"结论"},passed:{header:"通过"},publishedAt:{header:"发布状态",cell:({row:o})=>o.original.publishedAt?e.jsx("span",{children:"已发布"}):e.jsx(j,{size:"sm",onClick:()=>p.mutate(o.original.id),children:"发布"})}},children:e.jsx(R,{children:e.jsxs(j,{render:e.jsx(v,{to:"/onebridge/inspections/new"}),children:[e.jsx(k,{className:"mr-1 h-4 w-4"})," 新建报告"]})})})}const re=c(`
    query OnebridgeRfqDetail($id: ID) {
        onebridgeRfq(id: $id) {
            id
            code
            needType
            needLabel
            stage
            businessLine
            assignedTeam
            customerName
            customerContact
            customer {
                name
                contact
                locale
            }
            requirement {
                item
                qty
                eta
                memo
            }
            quote {
                amount
                currency
                validUntil
                note
            }
            sample {
                status
                trackingNo
                confirmedAt
            }
            timeline {
                stage
                title
                desc
                state
                time
            }
            createdAt
        }
    }
`),oe=c(`
    mutation SaveOnebridgeRfqQuote($rfqId: ID!, $input: RfqQuoteInput!) {
        saveRfqQuote(rfqId: $rfqId, input: $input) {
            amount
            currency
        }
    }
`),ie=c(`
    mutation SaveOnebridgeRfqSample($rfqId: ID!, $input: RfqSampleInput!) {
        saveRfqSample(rfqId: $rfqId, input: $input) {
            status
            trackingNo
        }
    }
`),ae=c(`
    mutation TransitionOnebridgeRfq($rfqId: ID!, $stage: CrossBorderStage!) {
        transitionRfqStage(rfqId: $rfqId, stage: $stage) {
            id
            stage
        }
    }
`),de=["wait_pay","quoting","requirement","sourcing","risk","sample","producing","shipping","qc","refund","delivered","customs","done","lost"];function le({route:t}){const{id:r}=t.useParams(),p=N(),[o,s]=C.useState(""),[l,g]=C.useState(""),[u,n]=C.useState(""),[i,f]=C.useState(""),{data:O,isLoading:T}=K({queryKey:["onebridge-rfq",r],queryFn:()=>x.query(re,{id:r})}),d=O?.onebridgeRfq,D=y({mutationFn:()=>x.mutate(oe,{rfqId:r,input:{amount:Number(o),currency:"KRW",note:"后台报价"}}),onSuccess:()=>{m.success("报价已保存"),p.invalidateQueries({queryKey:["onebridge-rfq",r]}),s("")},onError:a=>m.error(`报价保存失败: ${a.message}`)}),L=y({mutationFn:()=>x.mutate(ie,{rfqId:r,input:{status:l,trackingNo:u||null}}),onSuccess:()=>{m.success("样品信息已保存"),p.invalidateQueries({queryKey:["onebridge-rfq",r]})},onError:a=>m.error(`样品保存失败: ${a.message}`)}),A=y({mutationFn:()=>x.mutate(ae,{rfqId:r,stage:i}),onSuccess:()=>{m.success("阶段已跃迁"),p.invalidateQueries({queryKey:["onebridge-rfq",r]}),f("")},onError:a=>m.error(`跃迁失败: ${a.message}`)});return T?e.jsx("div",{className:"p-6",children:"加载中..."}):d?e.jsxs(q,{pageId:"onebridge-rfq-detail",children:[e.jsx(I,{children:d.code}),e.jsxs($,{children:[e.jsx(h,{column:"main",blockId:"onebridge-rfq-summary",children:e.jsx(b,{children:e.jsxs("div",{className:"grid grid-cols-2 gap-4 p-4 text-sm",children:[e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"需求"}),e.jsx("div",{children:d.needLabel})]}),e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"当前阶段"}),e.jsx("div",{children:d.stage})]}),e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"客户"}),e.jsxs("div",{children:[d.customerName," / ",d.customerContact]})]}),e.jsxs("div",{children:[e.jsx("div",{className:"text-muted-foreground",children:"业务线"}),e.jsx("div",{children:d.businessLine??"—"})]}),e.jsxs("div",{className:"col-span-2",children:[e.jsx("div",{className:"text-muted-foreground",children:"需求内容"}),e.jsx("div",{children:d.requirement?.item}),e.jsxs("div",{className:"text-xs text-muted-foreground",children:["qty=",d.requirement?.qty??"—"," / eta=",d.requirement?.eta??"—"]}),d.requirement?.memo?e.jsx("div",{children:d.requirement.memo}):null]})]})})}),e.jsx(h,{column:"main",blockId:"onebridge-rfq-quote",children:e.jsx(b,{children:e.jsxs("div",{className:"p-4",children:[e.jsx("h3",{className:"mb-3 font-semibold",children:"报价"}),e.jsxs("div",{className:"mb-3 text-sm",children:["当前: ",d.quote?`${d.quote.amount} ${d.quote.currency}`:"—"]}),e.jsxs("div",{className:"flex gap-2",children:[e.jsx("input",{className:"border rounded px-2 py-1 flex-1",placeholder:"报价金额（KRW）",value:o,onChange:a=>s(a.target.value)}),e.jsx(j,{onClick:()=>D.mutate(),disabled:!o,children:"保存报价"})]})]})})}),e.jsx(h,{column:"main",blockId:"onebridge-rfq-sample",children:e.jsx(b,{children:e.jsxs("div",{className:"p-4",children:[e.jsx("h3",{className:"mb-3 font-semibold",children:"样品"}),e.jsxs("div",{className:"mb-3 text-sm",children:["当前: ",d.sample?`${d.sample.status} / ${d.sample.trackingNo??"—"}`:"—"]}),e.jsxs("div",{className:"flex gap-2",children:[e.jsx("input",{className:"border rounded px-2 py-1",placeholder:"样品状态",value:l,onChange:a=>g(a.target.value)}),e.jsx("input",{className:"border rounded px-2 py-1",placeholder:"运单号",value:u,onChange:a=>n(a.target.value)}),e.jsx(j,{onClick:()=>L.mutate(),disabled:!l,children:"保存样品"})]})]})})}),e.jsx(h,{column:"main",blockId:"onebridge-rfq-transition",children:e.jsx(b,{children:e.jsxs("div",{className:"p-4",children:[e.jsx("h3",{className:"mb-3 font-semibold",children:"阶段跃迁"}),e.jsxs("div",{className:"flex gap-2",children:[e.jsxs("select",{className:"border rounded px-2 py-1",value:i,onChange:a=>f(a.target.value),children:[e.jsx("option",{value:"",children:"选择目标阶段"}),de.map(a=>e.jsx("option",{value:a,children:a},a))]}),e.jsx(j,{onClick:()=>A.mutate(),disabled:!i,children:"执行跃迁"})]})]})})}),e.jsx(h,{column:"main",blockId:"onebridge-rfq-timeline",children:e.jsx(b,{children:e.jsxs("div",{className:"p-4",children:[e.jsx("h3",{className:"mb-3 font-semibold",children:"时间轴"}),e.jsx("div",{className:"space-y-2",children:d.timeline.map((a,P)=>e.jsxs("div",{className:"text-sm",children:[e.jsx("span",{className:"mr-2 text-muted-foreground",children:a.time??"—"}),e.jsx("span",{className:"font-medium",children:a.title}),e.jsx("span",{className:"ml-2 text-muted-foreground",children:a.state}),a.desc?e.jsx("div",{className:"text-muted-foreground",children:a.desc}):null]},`${a.stage}-${P}`))})]})})})]})]}):e.jsx("div",{className:"p-6",children:"未找到 RFQ"})}const ce=c(`
    query OnebridgeRfqList($options: RfqListOptions) {
        onebridgeRfqs(options: $options) {
            totalItems
            items {
                id
                code
                needType
                needLabel
                customerName
                customerContact
                stage
                createdAt
            }
        }
    }
`);function ue({route:t}){return e.jsx(S,{pageId:"onebridge-rfq-list",title:"跨境询价",listQuery:ce,route:t,customizeColumns:{code:{header:"受理号",cell:({row:r})=>e.jsx(v,{to:`/onebridge/rfqs/${r.original.id}`,children:r.original.code})},needLabel:{header:"需求"},stage:{header:"阶段"},customerName:{header:"客户"},customerContact:{header:"联系方式"},createdAt:{header:"提交时间"}}})}const Te=E({routes:[{path:"/onebridge/rfqs",component:t=>e.jsx(ue,{route:t}),navMenuItem:{id:"onebridge-rfqs",title:"跨境询价",url:"/onebridge/rfqs",sectionId:"sales",requiresPermission:"OnebridgeRfqManage"}},{path:"/onebridge/rfqs/$id",component:t=>e.jsx(le,{route:t})},{path:"/onebridge/content",component:t=>e.jsx(B,{route:t}),navMenuItem:{id:"onebridge-content",title:"跨境内容",url:"/onebridge/content",sectionId:"marketing",requiresPermission:"OnebridgeContentManage"}},{path:"/onebridge/content/$id",component:t=>e.jsx(_,{route:t})},{path:"/onebridge/inspections",component:t=>e.jsx(ne,{route:t}),navMenuItem:{id:"onebridge-inspections",title:"跨境验货",url:"/onebridge/inspections",sectionId:"sales",requiresPermission:"OnebridgeInspectionManage"}},{path:"/onebridge/inspections/new",component:()=>e.jsx(ee,{})},{path:"/onebridge/customs",component:t=>e.jsx(X,{route:t}),navMenuItem:{id:"onebridge-customs",title:"跨境清关",url:"/onebridge/customs",sectionId:"sales",requiresPermission:"OnebridgeCustomsManage"}},{path:"/onebridge/customs/$orderCode",component:t=>e.jsx(G,{route:t})}]});export{Te as default};
