import{y as P,g as j,z as M,E as D,p as L,t as p,fb as v,a as b,j as e,T as a,r as f,F as T,fc as J,eN as w,fd as B,A as F,bb as N,bc as I,R as q,fe as G,B as g,bd as y,bh as R,cc as Q,ff as _}from"./index-BcOoJppr.js";import{L as $}from"./list-page-0RcighZE.js";import{D as z}from"./data-table-bulk-action-item-luoYiEPG.js";import{B as h,C as O,R as V}from"./rotate-ccw-CCaVt3ey.js";import{P as E}from"./payload-dialog-jLL1AcYc.js";const U=[["path",{d:"M12 2v4",key:"3427ic"}],["path",{d:"m16.2 7.8 2.9-2.9",key:"r700ao"}],["path",{d:"M18 12h4",key:"wj9ykh"}],["path",{d:"m16.2 16.2 2.9 2.9",key:"1bxg5t"}],["path",{d:"M12 18v4",key:"jadmvz"}],["path",{d:"m4.9 19.1 2.9-2.9",key:"bwix9q"}],["path",{d:"M2 12h4",key:"j09sii"}],["path",{d:"m4.9 4.9 2.9 2.9",key:"giyufr"}]],Z=P("Loader",U),S=j(`
    fragment JobInfo on Job {
        id
        queueName
        createdAt
        startedAt
        settledAt
        state
        isSettled
        progress
        duration
        data
        result
        error
        retries
        attempts
    }
`),H=j(`
        query JobList($options: JobListOptions) {
            jobs(options: $options) {
                items {
                    ...JobInfo
                }
                totalItems
            }
        }
    `,[S]),Y=j(`
    query JobQueueList {
        jobQueues {
            name
            running
        }
    }
`),k=j(`
        mutation CancelJob($jobId: ID!) {
            cancelJob(jobId: $jobId) {
                ...JobInfo
            }
        }
    `,[S]),K=({selection:r,table:c})=>{const{refetchPaginatedList:u}=M(),{_:n}=D(),d=r.filter(s=>s.state==="RUNNING"||s.state==="PENDING"),i=d.length,{mutate:x,isPending:t}=L({mutationFn:async()=>{const s=await Promise.allSettled(d.map(o=>b.mutate(k,{jobId:o.id}))),l=s.filter(o=>o.status==="fulfilled").length,m=s.filter(o=>o.status==="rejected").length;return{fulfilled:l,rejected:m}},onSuccess:({fulfilled:s,rejected:l})=>{s>0&&p.success(v._({id:"3BNwPT",values:{0:n({id:"0PZvtM",values:{fulfilled:s}}),1:n({id:"jyQIxx",values:{fulfilled:s}}),fulfilled:s}})),l>0&&p.error(v._({id:"mtjTGZ",values:{0:n({id:"Vm7mSV",values:{rejected:l}}),1:n({id:"swG/kW",values:{rejected:l}}),rejected:l}})),u(),c.resetRowSelection()}});return i===0?null:e.jsx(z,{requiresPermission:["DeleteSettings","DeleteSystem"],onClick:()=>x(),disabled:t,label:e.jsx(a,{id:"BQ46c7",values:{cancellableCount:i}}),confirmationText:e.jsx(a,{id:"wTQAyT",values:{cancellableCount:i}}),icon:h,className:"text-destructive"})};function X(r){if(r<1e3)return`${r}ms`;const c=Math.floor(r/1e3),u=Math.floor(c/60),n=Math.floor(u/60),d=Math.floor(n/24),i=[];return d>0&&i.push(`${d}d`),n%24>0&&i.push(`${n%24}h`),u%60>0&&i.push(`${u%60}m`),c%60>0&&i.push(`${c%60}s`),i.join(" ")}function W(r){switch(r){case"PENDING":case"RETRYING":return"warning";case"COMPLETED":return"success";case"FAILED":case"CANCELLED":return"destructive";default:return"secondary"}}const A=[{label:"Pending",value:"PENDING",icon:J},{label:"Completed",value:"COMPLETED",icon:w},{label:"Running",value:"RUNNING",icon:Z},{label:"Failed",value:"FAILED",icon:O},{label:"Retrying",value:"RETRYING",icon:V},{label:"Cancelled",value:"CANCELLED",icon:h}],C=[{label:e.jsx(a,{id:"az8lvo"}),value:0},{label:e.jsx(a,{id:"a5xvsE"}),value:5e3},{label:e.jsx(a,{id:"UFvKgT"}),value:1e4},{label:e.jsx(a,{id:"hYZ3aH"}),value:3e4},{label:e.jsx(a,{id:"rjE0f3"}),value:6e4}];function ie(){const r=f.useRef(()=>{}),{_:c}=D(),{formatRelativeDate:u}=T(),[n,d]=f.useState(1e4),i=f.useRef(!1);f.useEffect(()=>{if(n===0)return;const t=setInterval(()=>{i.current||r.current()},n);return()=>clearInterval(t)},[n]);const x=C.find(t=>t.value===n);return e.jsx($,{pageId:"job-queue-list",title:e.jsx(a,{id:"AsRAnH"}),defaultSort:[{id:"createdAt",desc:!0}],listQuery:H,route:B,customizeColumns:{createdAt:{cell:({row:t})=>e.jsx("div",{title:t.original.createdAt,children:u(t.original.createdAt)})},data:{cell:({row:t})=>e.jsx(E,{payload:t.original.data,title:e.jsx(a,{id:"XBRZ0Q"}),onOpenChange:s=>i.current=s,description:e.jsx(a,{id:"6V+g40"}),trigger:e.jsx(g,{size:"sm",variant:"secondary",children:e.jsx(a,{id:"gqSqrj"})})})},queueName:{cell:({row:t})=>e.jsx("span",{className:"font-mono",children:t.original.queueName})},result:{cell:({row:t})=>t.original.result?e.jsx(E,{payload:t.original.result,title:e.jsx(a,{id:"bDEHSp"}),onOpenChange:s=>i.current=s,description:e.jsx(a,{id:"swNxZp"}),trigger:e.jsx(g,{size:"sm",variant:"secondary",children:e.jsx(a,{id:"xwytAA"})})}):e.jsx("div",{className:"text-muted-foreground",children:e.jsx(a,{id:"YTKVwL"})})},state:{cell:({row:t,table:s})=>{const l=L({mutationFn:o=>b.mutate(k,{jobId:o}),onSuccess:()=>{r.current()}}),m=A.find(o=>o.value===t.original.state);return e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsxs(Q,{variant:W(t.original.state),children:[m&&e.jsx(m.icon,{className:t.original.state==="RUNNING"?"animate-spin":void 0}),t.original.state]}),t.original.state==="RUNNING"&&e.jsxs(N,{onOpenChange:o=>i.current=o,children:[e.jsx(I,{render:e.jsx(g,{variant:"ghost",size:"icon-xs"}),children:e.jsx(_,{})}),e.jsx(y,{align:"end",children:e.jsxs(R,{onClick:()=>l.mutate(t.original.id),disabled:l.isPending,className:"text-destructive focus:text-destructive",children:[e.jsx(h,{}),e.jsx(a,{id:"FnSb+y"})]})})]})]})}},duration:{cell:({row:t})=>t.original.duration?X(t.original.duration):null}},defaultVisibility:{isSettled:!1,settledAt:!1,progress:!1,retries:!1,attempts:!1,error:!1,startedAt:!1},facetedFilters:{queueName:{title:c({id:"b24kPi"}),optionsFn:async()=>b.query(Y).then(t=>t.jobQueues.map(s=>({label:s.name,value:s.name})))},state:{title:c({id:"RS0o7b"}),options:A}},bulkActions:[{component:K,order:100}],registerRefresher:t=>{r.current=t},children:e.jsx(F,{itemId:"auto-refresh-button",children:e.jsxs(N,{children:[e.jsxs(I,{render:e.jsx(g,{variant:"outline",size:"sm",className:"gap-2"}),children:[e.jsx(q,{className:"h-4 w-4"}),e.jsx("span",{children:e.jsx(a,{id:"0OgmBr",values:{0:x?.label}})}),e.jsx(G,{className:"h-4 w-4"})]}),e.jsx(y,{align:"end",children:C.map(t=>e.jsx(R,{onClick:()=>d(t.value),className:n===t.value?"bg-accent":"",children:t.label},t.value))})]})})})}export{ie as component};
