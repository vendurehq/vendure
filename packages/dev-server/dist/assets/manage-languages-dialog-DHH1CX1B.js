import{bn as T,aS as k,o as Z,r as x,u as _,p as O,t as h,a as L,j as e,b9 as B,aY as I,aZ as V,a_ as Y,T as s,a$ as z,bA as F,bB as y,b0 as N,bC as X,bw as H,bp as W,b1 as ee,b2 as ae,b3 as se,b4 as ne,b5 as te,b6 as le,B as R,g as G}from"./index-BEWB-Tpc.js";import{u as ie,L as w}from"./language-selector-DcnAQ26p.js";const de=G(`
    query GlobalSettingsLanguages {
        globalSettings {
            id
            availableLanguages
        }
    }
`),oe=G(`
    mutation UpdateGlobalSettingsLanguages($input: UpdateGlobalSettingsInput!) {
        updateGlobalSettings(input: $input) {
            __typename
            ... on GlobalSettings {
                id
                availableLanguages
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`),re=G(`
    mutation UpdateChannelLanguages($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            __typename
            ... on Channel {
                id
                code
                defaultLanguageCode
                availableLanguageCodes
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);function xe({open:g,onClose:p}){const{activeChannel:J}=T(),{hasPermissions:i}=k(),u=Z(),t=J,b=i(["ReadSettings"])||i(["ReadGlobalSettings"]),j=i(["UpdateSettings"])||i(["UpdateGlobalSettings"]),D=i(["ReadChannel"]),c=i(["UpdateChannel"]),[d,U]=x.useState([]),[o,f]=x.useState([]),[r,m]=x.useState(""),C=ie(o||[]),{data:l,isLoading:$,error:A}=_({queryKey:["globalSettings","languages"],queryFn:()=>L.query(de),enabled:g&&b}),E=O({mutationFn:a=>L.mutate(oe,{input:a}),onSuccess:()=>{u.invalidateQueries({queryKey:["globalSettings"]}),u.invalidateQueries({queryKey:["getServerConfig"]}),h.success("Global language settings updated successfully")},onError:a=>{h.error(`Failed to update global settings: ${a.message}`)}}),q=O({mutationFn:a=>L.mutate(re,{input:a}),onSuccess:()=>{u.invalidateQueries({queryKey:["channels"]}),u.invalidateQueries({queryKey:["activeChannel"]}),h.success("Channel language settings updated successfully")},onError:a=>{h.error(`Failed to update channel settings: ${a.message}`)}});x.useEffect(()=>{g&&l&&U(l.globalSettings.availableLanguages||[]),g&&t&&(f(t.availableLanguageCodes||[]),m(t.defaultLanguageCode||""))},[g,l,t]);const K=a=>{U(a);const n=o.filter(S=>a.includes(S));f(n),a.includes(r)||m(n[0]||"")},M=a=>{f(a),a.includes(r)||m(a[0]||"")},P=async()=>{const a=[];if(j&&l){const n=l.globalSettings.availableLanguages||[];JSON.stringify(n.sort())!==JSON.stringify(d.sort())&&a.push(E.mutateAsync({availableLanguages:d}))}if(c&&t){const n=t.availableLanguageCodes||[],S=t.defaultLanguageCode||"";(JSON.stringify(n.sort())!==JSON.stringify(o.sort())||S!==r)&&a.push(q.mutateAsync({id:t.id,availableLanguageCodes:o,defaultLanguageCode:r}))}try{await Promise.all(a),p()}catch{}},Q=()=>{if(l&&j){const a=l.globalSettings.availableLanguages||[];if(JSON.stringify(a.sort())!==JSON.stringify(d.sort()))return!0}if(t&&c){const a=t.availableLanguageCodes||[],n=t.defaultLanguageCode||"";return JSON.stringify(a.sort())!==JSON.stringify(o.sort())||n!==r}return!1},v=E.isPending||q.isPending;return e.jsx(B,{open:g,onOpenChange:p,children:e.jsxs(I,{className:"max-w-2xl max-h-[80vh] overflow-y-auto",children:[e.jsxs(V,{children:[e.jsx(Y,{children:e.jsx(s,{id:"+KsEPl"})}),e.jsx(z,{children:e.jsx(s,{id:"TUn15d"})})]}),e.jsxs("div",{className:"space-y-6",children:[e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3",children:[e.jsx("h3",{className:"font-semibold",children:e.jsx(s,{id:"wCiE/8"})}),!b&&e.jsx(F,{className:"h-4 w-4 text-muted-foreground"})]}),b?$?e.jsx("div",{className:"text-sm text-muted-foreground",children:e.jsx(s,{id:"cZfFVY"})}):A?e.jsxs("div",{className:"flex items-center gap-2 p-3 bg-destructive/10 rounded-md",children:[e.jsx(y,{className:"h-4 w-4 text-destructive"}),e.jsx("span",{className:"text-sm text-destructive",children:e.jsx(s,{id:"tdu1lo"})})]}):e.jsxs("div",{className:"space-y-2",children:[e.jsx(N,{children:e.jsx(s,{id:"lZ1k+X"})}),e.jsx("div",{className:j?"":"pointer-events-none opacity-50",children:e.jsx(w,{value:d,onChange:K,multiple:!0,availableLanguageCodes:X})}),e.jsx("p",{className:"text-xs text-muted-foreground",children:e.jsx(s,{id:"zYRRLp"})})]}):e.jsxs("div",{className:"flex items-center gap-2 p-3 bg-muted rounded-md",children:[e.jsx(y,{className:"h-4 w-4 text-muted-foreground"}),e.jsx("span",{className:"text-sm text-muted-foreground",children:e.jsx(s,{id:"yJyG7D"})})]})]}),e.jsx(H,{}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3",children:[e.jsxs("h3",{className:"font-semibold",children:[e.jsx(s,{id:"bZmZc2"})," -"," ",e.jsx(W,{code:t?.code})]}),!D&&e.jsx(F,{className:"h-4 w-4 text-muted-foreground"})]}),D?e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"space-y-2",children:[e.jsx(N,{className:"text-sm font-medium",children:e.jsx(s,{id:"pLwWyo"})}),e.jsx("div",{className:c?"":"pointer-events-none opacity-50",children:e.jsx(w,{value:o,onChange:M,multiple:!0,availableLanguageCodes:d})}),d.length===0?e.jsx("p",{className:"text-xs text-muted-foreground",children:e.jsx(s,{id:"j2a7dU"})}):e.jsx("p",{className:"text-xs text-muted-foreground",children:e.jsx(s,{id:"F+Cfi2"})})]}),C.length>0&&e.jsxs("div",{children:[e.jsx(N,{className:"text-sm font-medium mb-2 block",children:e.jsx(s,{id:"TOFdm+"})}),e.jsxs(ee,{items:Object.fromEntries(C.map(({code:a,label:n})=>[a,`${n} (${a.toUpperCase()})`])),value:r,onValueChange:a=>{a!=null&&m(a)},disabled:!c,children:[e.jsx(ae,{className:"w-[200px]",children:e.jsx(se,{placeholder:"Select default language"})}),e.jsx(ne,{children:C.map(({code:a,label:n})=>e.jsxs(te,{value:a,children:[n," (",a.toUpperCase(),")"]},a))})]})]})]}):e.jsxs("div",{className:"flex items-center gap-2 p-3 bg-muted rounded-md",children:[e.jsx(y,{className:"h-4 w-4 text-muted-foreground"}),e.jsx("span",{className:"text-sm text-muted-foreground",children:e.jsx(s,{id:"eB+0qz"})})]})]})]}),e.jsxs(le,{children:[e.jsx(R,{variant:"outline",onClick:p,disabled:v,children:e.jsx(s,{id:"dEgA5A"})}),e.jsx(R,{onClick:P,disabled:!Q()||v,children:v?e.jsx(s,{id:"XvjC4F"}):e.jsx(s,{id:"IUwGEM"})})]})]})})}export{xe as M};
