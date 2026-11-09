import{bo as k,aT as A,o as Z,r as m,u as _,p as O,t as h,a as L,j as e,ba as B,aZ as I,a_ as V,a$ as z,T as s,b0 as X,bB as F,bC as y,b1 as N,bD as Y,bx as H,bq as W,b2 as ee,b3 as ae,b4 as se,b5 as te,b6 as ne,b7 as le,B as R,g as D}from"./index-C9uJSeZM.js";import{u as ie,L as J}from"./language-selector-CsotLSor.js";const de=D(`
    query GlobalSettingsLanguages {
        globalSettings {
            id
            availableLanguages
        }
    }
`),oe=D(`
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
`),re=D(`
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
`);function me({open:g,onClose:p}){const{activeChannel:$}=k(),{hasPermissions:i}=A(),u=Z(),n=$,b=i(["ReadSettings"])||i(["ReadGlobalSettings"]),j=i(["UpdateSettings"])||i(["UpdateGlobalSettings"]),G=i(["ReadChannel"]),c=i(["UpdateChannel"]),[d,U]=m.useState([]),[o,f]=m.useState([]),[r,x]=m.useState(""),C=ie(o||[]),{data:l,isLoading:w,error:T}=_({queryKey:["globalSettings","languages"],queryFn:()=>L.query(de),enabled:g&&b}),E=O({mutationFn:a=>L.mutate(oe,{input:a}),onSuccess:()=>{u.invalidateQueries({queryKey:["globalSettings"]}),u.invalidateQueries({queryKey:["getServerConfig"]}),h.success("Global language settings updated successfully")},onError:a=>{h.error(`Failed to update global settings: ${a.message}`)}}),q=O({mutationFn:a=>L.mutate(re,{input:a}),onSuccess:()=>{u.invalidateQueries({queryKey:["channels"]}),u.invalidateQueries({queryKey:["activeChannel"]}),h.success("Channel language settings updated successfully")},onError:a=>{h.error(`Failed to update channel settings: ${a.message}`)}});m.useEffect(()=>{g&&l&&U(l.globalSettings.availableLanguages||[]),g&&n&&(f(n.availableLanguageCodes||[]),x(n.defaultLanguageCode||""))},[g,l,n]);const K=a=>{U(a);const t=o.filter(S=>a.includes(S));f(t),a.includes(r)||x(t[0]||"")},M=a=>{f(a),a.includes(r)||x(a[0]||"")},P=async()=>{const a=[];if(j&&l){const t=l.globalSettings.availableLanguages||[];JSON.stringify(t.sort())!==JSON.stringify(d.sort())&&a.push(E.mutateAsync({availableLanguages:d}))}if(c&&n){const t=n.availableLanguageCodes||[],S=n.defaultLanguageCode||"";(JSON.stringify(t.sort())!==JSON.stringify(o.sort())||S!==r)&&a.push(q.mutateAsync({id:n.id,availableLanguageCodes:o,defaultLanguageCode:r}))}try{await Promise.all(a),p()}catch{}},Q=()=>{if(l&&j){const a=l.globalSettings.availableLanguages||[];if(JSON.stringify(a.sort())!==JSON.stringify(d.sort()))return!0}if(n&&c){const a=n.availableLanguageCodes||[],t=n.defaultLanguageCode||"";return JSON.stringify(a.sort())!==JSON.stringify(o.sort())||t!==r}return!1},v=E.isPending||q.isPending;return e.jsx(B,{open:g,onOpenChange:p,children:e.jsxs(I,{className:"max-w-2xl max-h-[80vh] overflow-y-auto",children:[e.jsxs(V,{children:[e.jsx(z,{children:e.jsx(s,{id:"+KsEPl"})}),e.jsx(X,{children:e.jsx(s,{id:"TUn15d"})})]}),e.jsxs("div",{className:"space-y-6",children:[e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3",children:[e.jsx("h3",{className:"font-semibold",children:e.jsx(s,{id:"wCiE/8"})}),!b&&e.jsx(F,{className:"h-4 w-4 text-muted-foreground"})]}),b?w?e.jsx("div",{className:"text-sm text-muted-foreground",children:e.jsx(s,{id:"cZfFVY"})}):T?e.jsxs("div",{className:"flex items-center gap-2 p-3 bg-destructive/10 rounded-md",children:[e.jsx(y,{className:"h-4 w-4 text-destructive"}),e.jsx("span",{className:"text-sm text-destructive",children:e.jsx(s,{id:"tdu1lo"})})]}):e.jsxs("div",{className:"space-y-2",children:[e.jsx(N,{children:e.jsx(s,{id:"lZ1k+X"})}),e.jsx("div",{className:j?"":"pointer-events-none opacity-50",children:e.jsx(J,{value:d,onChange:K,multiple:!0,availableLanguageCodes:Y})}),e.jsx("p",{className:"text-xs text-muted-foreground",children:e.jsx(s,{id:"zYRRLp"})})]}):e.jsxs("div",{className:"flex items-center gap-2 p-3 bg-muted rounded-md",children:[e.jsx(y,{className:"h-4 w-4 text-muted-foreground"}),e.jsx("span",{className:"text-sm text-muted-foreground",children:e.jsx(s,{id:"yJyG7D"})})]})]}),e.jsx(H,{}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3",children:[e.jsxs("h3",{className:"font-semibold",children:[e.jsx(s,{id:"bZmZc2"})," -"," ",e.jsx(W,{code:n?.code})]}),!G&&e.jsx(F,{className:"h-4 w-4 text-muted-foreground"})]}),G?e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"space-y-2",children:[e.jsx(N,{className:"text-sm font-medium",children:e.jsx(s,{id:"pLwWyo"})}),e.jsx("div",{className:c?"":"pointer-events-none opacity-50",children:e.jsx(J,{value:o,onChange:M,multiple:!0,availableLanguageCodes:d})}),d.length===0?e.jsx("p",{className:"text-xs text-muted-foreground",children:e.jsx(s,{id:"j2a7dU"})}):e.jsx("p",{className:"text-xs text-muted-foreground",children:e.jsx(s,{id:"F+Cfi2"})})]}),C.length>0&&e.jsxs("div",{children:[e.jsx(N,{className:"text-sm font-medium mb-2 block",children:e.jsx(s,{id:"TOFdm+"})}),e.jsxs(ee,{items:Object.fromEntries(C.map(({code:a,label:t})=>[a,`${t} (${a.toUpperCase()})`])),value:r,onValueChange:a=>{a!=null&&x(a)},disabled:!c,children:[e.jsx(ae,{className:"w-[200px]",children:e.jsx(se,{placeholder:"Select default language"})}),e.jsx(te,{children:C.map(({code:a,label:t})=>e.jsxs(ne,{value:a,children:[t," (",a.toUpperCase(),")"]},a))})]})]})]}):e.jsxs("div",{className:"flex items-center gap-2 p-3 bg-muted rounded-md",children:[e.jsx(y,{className:"h-4 w-4 text-muted-foreground"}),e.jsx("span",{className:"text-sm text-muted-foreground",children:e.jsx(s,{id:"eB+0qz"})})]})]})]}),e.jsxs(le,{children:[e.jsx(R,{variant:"outline",onClick:p,disabled:v,children:e.jsx(s,{id:"dEgA5A"})}),e.jsx(R,{onClick:P,disabled:!Q()||v,children:v?e.jsx(s,{id:"XvjC4F"}):e.jsx(s,{id:"IUwGEM"})})]})]})})}export{me as M};
