import{g as I,r as g,u as L,a as D,t as M,j as e,L as B,T as l,S as Ce,C as Ie,X as we,R as ke,d as J,b as _,c as Z,P as Y,e as X,f as ee,h as te,B as A,i as ie,k as $,D as z,l as q,m as ue,n as H,o as se,p as R,A as ne,q as re,s as ae,v as oe,w as le,N as De,x as Me}from"./index-BEWB-Tpc.js";import"./manage-languages-dialog-DHH1CX1B.js";import"./login-form--sKT3uaa.js";import"./channel-selector-CjlI3I-E.js";import"./country-selector-CrUSS7-U.js";import"./customer-address-form-xPoHsKeW.js";import"./customer-selector-BwblO224.js";import"./history-entry-extensions-BN58gOF7.js";import"./language-selector-DcnAQ26p.js";import"./product-variant-selector-Cm9RuJrE.js";import"./role-selector-y8H1yH-z.js";import"./seller-selector-DVIOdKp7.js";import"./tax-category-selector-CY-uoW2p.js";import"./zone-selector-CVjynmwB.js";import"./sidebar-context-Jw8BEXxL.js";import"./common-operations-MAx-dweV.js";import"./use-job-queue-polling-AYm6bnNF.js";import{F as k}from"./form-field-wrapper-Cvabj0WC.js";import{M as Ne}from"./map-pin-BoB4KXB4.js";import{D as T}from"./detail-page-button-C5ZVdUuQ.js";import{L as ce}from"./list-page-B2i9jzml.js";import"./eye-LjRQVh9Q.js";const qe=[{pageId:"channel-detail",extendDetailDocument:`
            query ExtendChannelCustomDomains {
                channel {
                    customFields {
                        customDomains
                    }
                }
            }
        `}],Le=[{pageId:"promotion-detail"}],me=I(`
    query GetMapSdkConfig {
        mapSdkConfig {
            provider
            sdkUrl
            hasConfigured
        }
    }
`),E=I(`
    query GetMapDistricts($parentAdcode: String) {
        mapDistricts(parentAdcode: $parentAdcode) {
            adcode
            name
            level
            center {
                lat
                lng
            }
        }
    }
`),Ae=I(`
    query ReverseGeocode($lat: Float!, $lng: Float!) {
        reverseGeocode(lat: $lat, lng: $lng) {
            province
            city
            district
            street
            formattedAddress
        }
    }
`);let G=null;async function $e(n){return G||(G=new Promise((s,c)=>{const a=document.createElement("script");a.src=n,a.async=!0,a.onload=()=>{const t=window.AMap;t?s(t):c(new Error("高德 SDK 加载完成但 window.AMap 未定义"))},a.onerror=()=>{G=null,c(new Error("高德 SDK 加载失败"))},document.head.appendChild(a)}),G)}const Ke=g.forwardRef(function({value:s,onChange:c,onReverseGeocode:a,initialCenter:t,initialZoom:p},d){const m=g.useRef(null),o=g.useRef(null),u=g.useRef(null),j=g.useRef(null),[i,x]=g.useState(null),[b,v]=g.useState(!0),[f,r]=g.useState(!1),[S,Q]=g.useState(""),[de,U]=g.useState([]),[ge,O]=g.useState(!1),F=L({queryKey:["mapSdkConfig"],queryFn:()=>D.query(me,void 0),retry:3});g.useImperativeHandle(d,()=>({setCenter:(h,y,C=!0,w)=>{const N=window.AMap;o.current&&(o.current.setCenter([h,y]),w!=null&&o.current.setZoom(w),C&&(u.current?u.current.setPosition([h,y]):u.current=new N.Marker({position:[h,y],map:o.current}),c({lat:y,lng:h})))},clearMarker:()=>{u.current&&(u.current.setMap(null),u.current=null),c(null)}})),g.useEffect(()=>{if(!F.data)return;const h=F.data.mapSdkConfig;if(!h.hasConfigured){v(!1);return}v(!0),$e(h.sdkUrl).then(()=>{x(null),v(!1)}).catch(y=>{x(y.message),v(!1)})},[F.data]),g.useEffect(()=>{if(b||i)return;const h=window.AMap;if(!h||!m.current||o.current)return;const y=s&&s.lng!=null&&s.lat!=null,C=t&&t.lng!=null&&t.lat!=null,w=y?[s.lng,s.lat]:C?[t.lng,t.lat]:[116.397428,39.90923];o.current=new h.Map(m.current,{zoom:p??15,center:w}),y&&(u.current=new h.Marker({position:[s.lng,s.lat],map:o.current}));try{j.current=new h.AutoComplete({city:"全国"})}catch(N){console.warn("AutoComplete plugin init failed",N)}return o.current.on("click",N=>{const Pe=N.lnglat.getLng(),Se=N.lnglat.getLat();je(Se,Pe)}),()=>{o.current?.destroy?.(),o.current=null,u.current=null,j.current=null}},[b,i]);const je=async(h,y)=>{const C=window.AMap;o.current&&(u.current?u.current.setPosition([y,h]):u.current=new C.Marker({position:[y,h],map:o.current}),c({lat:h,lng:y}),await W(h,y))},W=async(h,y)=>{try{const w=(await D.query(Ae,{lat:h,lng:y})).reverseGeocode;a?.({province:w.province,city:w.city,district:w.district,street:w.street,formattedAddress:w.formattedAddress})}catch(C){M.error("逆地理编码失败: "+(C?.message??"未知错误"))}},fe=()=>{if(!navigator.geolocation){M.error("浏览器不支持定位功能");return}r(!0),navigator.geolocation.getCurrentPosition(async h=>{const{latitude:y,longitude:C}=h.coords,w=window.AMap;o.current&&(o.current.setCenter([C,y]),u.current?u.current.setPosition([C,y]):u.current=new w.Marker({position:[C,y],map:o.current}),c({lat:y,lng:C}),await W(y,C)),r(!1)},h=>{r(!1);const y=h.code===1?"定位权限被拒绝":h.code===2?"位置不可用":"定位超时";M.error("定位失败: "+y+"，请手动搜索或点击地图")},{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})};g.useEffect(()=>{if(!S||S.length<2){U([]),O(!1);return}if(!j.current)return;const h=setTimeout(()=>{j.current.search(S,(y,C)=>{if(y==="complete"&&C.tips){const w=C.tips.filter(N=>N.location).map(N=>({name:N.name,location:{lng:N.location.lng,lat:N.location.lat},adcode:N.adcode}));U(w),O(!0)}else U([]),O(!1)})},300);return()=>clearTimeout(h)},[S]);const be=async h=>{const y=window.AMap,{lng:C,lat:w}=h.location;o.current&&(o.current.setCenter([C,w]),o.current.setZoom(15),u.current?u.current.setPosition([C,w]):u.current=new y.Marker({position:[C,w],map:o.current}),c({lat:w,lng:C}),await W(w,C)),Q(h.name),O(!1)},ve=()=>{u.current&&(u.current.setMap(null),u.current=null),c(null)};if(F.isLoading)return e.jsx("div",{className:"h-[400px] flex items-center justify-center border rounded",children:e.jsx(B,{className:"h-6 w-6 animate-spin"})});if(F.isError)return e.jsx("div",{className:"h-[400px] flex items-center justify-center border rounded text-destructive",children:e.jsx(l,{id:"sSm128"})});if(!F.data?.mapSdkConfig?.hasConfigured)return e.jsx("div",{className:"h-[400px] flex items-center justify-center border rounded bg-muted/30 text-sm text-muted-foreground text-center px-4",children:e.jsx(l,{id:"PEq0bA"})});if(b)return e.jsxs("div",{className:"h-[400px] flex items-center justify-center border rounded gap-2",children:[e.jsx(B,{className:"h-6 w-6 animate-spin"})," ",e.jsx(l,{id:"c8R1wS"})]});if(i)return e.jsxs("div",{className:"h-[400px] flex flex-col items-center justify-center border rounded text-destructive gap-2",children:[e.jsxs("span",{children:[e.jsx(l,{id:"+l/S4N"}),"：",i]}),e.jsx("button",{onClick:()=>{x(null),v(!0)},className:"px-3 py-1 border rounded",children:e.jsx(l,{id:"YvXpzm"})})]});const pe=s&&s.lng!=null&&s.lat!=null;return e.jsxs("div",{className:"space-y-2",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsxs("div",{className:"relative flex-1",children:[e.jsx(Ce,{className:"absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"}),e.jsx("input",{type:"text",value:S,onChange:h=>Q(h.target.value),placeholder:"搜索地址（如：双阳区、欧亚卖场）",className:"w-full border rounded pl-8 pr-2 py-1 text-sm"}),ge&&de.length>0&&e.jsx("div",{className:"absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-60 overflow-auto",children:de.map((h,y)=>e.jsx("button",{type:"button",onClick:()=>be(h),className:"block w-full text-left px-3 py-2 text-sm hover:bg-muted/30 border-b last:border-b-0",children:h.name},y))})]}),e.jsxs("button",{type:"button",onClick:fe,disabled:f,className:"flex items-center gap-1 px-3 py-1 border rounded text-sm disabled:opacity-50",title:"定位当前位置",children:[f?e.jsx(B,{className:"h-4 w-4 animate-spin"}):e.jsx(Ie,{className:"h-4 w-4"}),e.jsx(l,{id:"/uYz4M"})]})]}),e.jsxs("div",{className:"flex items-center justify-between",children:[e.jsx("span",{className:"text-sm font-medium",children:e.jsx(l,{id:"uLw0Iw"})}),pe&&e.jsxs("button",{onClick:ve,className:"flex items-center gap-1 text-sm text-destructive",children:[e.jsx(we,{className:"h-4 w-4"})," ",e.jsx(l,{id:"na2fXJ"})]})]}),e.jsx("div",{ref:m,className:"h-[400px] w-full border rounded"}),pe&&e.jsxs("div",{className:"flex items-center gap-2 text-sm text-muted-foreground",children:[e.jsx(Ne,{className:"h-4 w-4"}),e.jsx(l,{id:"MVjKm4"}),": ",s.lng.toFixed(6),", ",e.jsx(l,{id:"Qp/S7M"}),": ",s.lat.toFixed(6)]})]})});function Te({value:n,onChange:s,hasConfigured:c,onRegionCenterChange:a}){const[t,p]=g.useState({}),d=L({queryKey:["mapDistricts",null],queryFn:()=>D.query(E,{parentAdcode:null}),enabled:c,retry:!1}),m=L({queryKey:["mapDistricts",t.province],queryFn:()=>D.query(E,{parentAdcode:t.province}),enabled:c&&!!t.province,retry:!1}),o=L({queryKey:["mapDistricts",t.city],queryFn:()=>D.query(E,{parentAdcode:t.city}),enabled:c&&!!t.city,retry:!1}),u=L({queryKey:["mapDistricts",t.district],queryFn:()=>D.query(E,{parentAdcode:t.district}),enabled:c&&!!t.district,retry:!1});if(g.useEffect(()=>{if(!d.data)return;const f=d.data.mapDistricts.find(r=>r.name===n.province);f&&!t.province&&p(r=>({...r,province:f.adcode}))},[d.data,n.province]),g.useEffect(()=>{if(!m.data||!n.city)return;const f=m.data.mapDistricts.find(r=>r.name===n.city);f&&!t.city&&p(r=>({...r,city:f.adcode}))},[m.data,n.city]),g.useEffect(()=>{if(!o.data||!n.district)return;const f=o.data.mapDistricts.find(r=>r.name===n.district);f&&!t.district&&p(r=>({...r,district:f.adcode}))},[o.data,n.district]),g.useEffect(()=>{if(!u.data||!n.street)return;const f=u.data.mapDistricts.find(r=>r.name===n.street);f&&!t.street&&p(r=>({...r,street:f.adcode}))},[u.data,n.street]),!c)return e.jsx("div",{className:"col-span-2 p-4 border rounded bg-muted/30 text-sm text-muted-foreground",children:e.jsx(l,{id:"XI4VCo"})});const j=v=>{const f=v.target.value,r=d.data?.mapDistricts?.find(S=>S.adcode===f);p({province:f}),s({province:r?.name??"",city:"",district:"",street:""}),r?.center&&a?.(r.center,"province")},i=v=>{const f=v.target.value,r=m.data?.mapDistricts?.find(S=>S.adcode===f);p(S=>({...S,province:S.province,city:f,district:void 0,street:void 0})),s({province:n.province,city:r?.name??"",district:"",street:""}),r?.center&&a?.(r.center,"city")},x=v=>{const f=v.target.value,r=o.data?.mapDistricts?.find(S=>S.adcode===f);p(S=>({...S,province:S.province,city:S.city,district:f,street:void 0})),s({province:n.province,city:n.city,district:r?.name??"",street:""}),r?.center&&a?.(r.center,"district")},b=v=>{const f=v.target.value,r=u.data?.mapDistricts?.find(S=>S.adcode===f);p(S=>({...S,street:f})),s({province:n.province,city:n.city,district:n.district,street:r?.name??""})};return e.jsxs("div",{className:"col-span-2 grid grid-cols-2 md:grid-cols-4 gap-2",children:[e.jsx(V,{label:e.jsx(l,{id:"XgxmOg"}),value:t.province??"",onChange:j,options:d.data?.mapDistricts,loading:d.isLoading,error:d.isError,onRetry:()=>d.refetch()}),e.jsx(V,{label:e.jsx(l,{id:"yIdVzD"}),value:t.city??"",onChange:i,options:m.data?.mapDistricts,loading:m.isLoading,error:m.isError,onRetry:()=>m.refetch(),disabled:!t.province}),e.jsx(V,{label:e.jsx(l,{id:"di8uB2"}),value:t.district??"",onChange:x,options:o.data?.mapDistricts,loading:o.isLoading,error:o.isError,onRetry:()=>o.refetch(),disabled:!t.city}),e.jsx(V,{label:e.jsx(l,{id:"dcHVyS"}),value:t.street??"",onChange:b,options:u.data?.mapDistricts,loading:u.isLoading,error:u.isError,onRetry:()=>u.refetch(),disabled:!t.district})]})}function V({label:n,value:s,onChange:c,options:a,loading:t,error:p,onRetry:d,disabled:m}){return e.jsxs("div",{children:[e.jsx("label",{className:"text-sm font-medium mb-1 block",children:n}),t?e.jsxs("div",{className:"flex items-center gap-2 text-sm text-muted-foreground",children:[e.jsx(B,{className:"h-4 w-4 animate-spin"})," ",e.jsx(l,{id:"GdAO6m"})]}):p?e.jsxs("button",{onClick:d,className:"flex items-center gap-2 text-sm text-destructive",children:[e.jsx(ke,{className:"h-4 w-4"})," ",e.jsx(l,{id:"np7YOK"})]}):e.jsxs("select",{value:s,onChange:c,disabled:m,className:"w-full border rounded px-2 py-1 text-sm disabled:bg-muted/30",children:[e.jsx("option",{value:"",children:"请选择"}),a?.map(o=>e.jsx("option",{value:o.adcode,children:o.name},o.adcode))]})]})}const he=I(`
    query GetPickupLocationDetail($id: ID!) {
        pickupLocation(id: $id) {
            id
            name
            type
            address
            phoneNumber
            businessHours
            coordinates
            partner
            isPublic
            province
            city
            district
            street
        }
    }
`),Fe=I(`
    mutation CreatePickupLocation($input: CreatePickupLocationInput!) {
        createPickupLocation(input: $input) {
            id
            name
        }
    }
`),Ge=I(`
    mutation UpdatePickupLocation($input: UpdatePickupLocationInput!) {
        updatePickupLocation(input: $input) {
            id
            name
        }
    }
`),Re={path:"/pickup-locations/$id",loader:J({queryDocument:he,breadcrumb:(n,s)=>[{path:"/pickup-locations",label:"自提点管理"},n?"新建":s?.name??"详情"]}),component:n=>e.jsx(Qe,{route:n})};function Qe({route:n}){const s=n.useParams(),c=_(),a=g.useRef(null),[t,p]=g.useState(!1),[d,m]=g.useState(null),{form:o,submitHandler:u,entity:j,isPending:i}=Z({queryDocument:he,createDocument:Fe,updateDocument:Ge,params:{id:s.id},setValuesForUpdate:r=>({id:r.id,name:r.name,type:r.type,address:r.address,phoneNumber:r.phoneNumber,businessHours:r.businessHours,coordinates:r.coordinates,partner:r.partner,province:r.province,city:r.city,district:r.district,street:r.street,isPublic:r.isPublic}),onSuccess:async r=>{M.success(j?"更新成功":"创建成功"),!j&&r.id&&await c({to:"../$id",params:{id:r.id}})},onError:r=>{M.error("保存失败: "+(r?.message??"未知错误"))}}),b=L({queryKey:["mapSdkConfig"],queryFn:()=>D.query(me,void 0),retry:3}).data?.mapSdkConfig?.hasConfigured??!1;g.useEffect(()=>{j?.coordinates?.lat!=null&&j?.coordinates?.lng!=null&&(m({lat:j.coordinates.lat,lng:j.coordinates.lng}),p(!0))},[j]);const v=r=>{o.setValue("province",r.province||null,{shouldDirty:!0}),o.setValue("city",r.city||null,{shouldDirty:!0}),o.setValue("district",r.district||null,{shouldDirty:!0}),o.setValue("street",r.street||null,{shouldDirty:!0})},f=r=>{r.province&&o.setValue("province",r.province,{shouldDirty:!0}),r.city&&o.setValue("city",r.city,{shouldDirty:!0}),r.district&&o.setValue("district",r.district,{shouldDirty:!0}),r.formattedAddress&&o.setValue("address",r.formattedAddress,{shouldDirty:!0})};return e.jsxs(Y,{pageId:"pickup-location-detail",form:o,submitHandler:u,children:[e.jsx(X,{children:j?.name??e.jsx(l,{id:"ie9Wii"})}),e.jsx(ee,{children:e.jsx(te,{children:e.jsx(A,{type:"submit",disabled:!o.formState.isDirty||i,children:j?e.jsx(l,{id:"jBG25x"}):e.jsx(l,{id:"lLPWZb"})})})}),e.jsxs(ie,{children:[e.jsx($,{column:"main",blockId:"basic-info",children:e.jsxs(z,{children:[e.jsx(k,{control:o.control,name:"name",label:e.jsx(l,{id:"+bnz4W"}),render:({field:r})=>e.jsx(q,{...r,placeholder:"如：双阳商城店"})}),e.jsx(k,{control:o.control,name:"type",label:e.jsx(l,{id:"D/FLMI"}),render:({field:r})=>e.jsxs("select",{value:r.value??"store",onChange:r.onChange,className:"w-full border rounded px-2 py-1 text-sm",children:[e.jsx("option",{value:"store",children:"门店"}),e.jsx("option",{value:"point",children:"驿站"}),e.jsx("option",{value:"employee",children:"员工自提点"})]})}),e.jsx(k,{control:o.control,name:"phoneNumber",label:e.jsx(l,{id:"XYhKCz"}),render:({field:r})=>e.jsx(q,{...r,placeholder:"如：0431-84221001"})}),e.jsx(k,{control:o.control,name:"businessHours",label:e.jsx(l,{id:"CQotVI"}),render:({field:r})=>e.jsx(q,{...r,placeholder:"如：09:00-22:00"})}),e.jsx(k,{control:o.control,name:"partner",label:e.jsx(l,{id:"NkXyCj"}),render:({field:r})=>e.jsx(q,{...r})}),e.jsx(k,{control:o.control,name:"isPublic",label:e.jsx(l,{id:"QHCV6v"}),render:({field:r})=>e.jsx(ue,{...r})})]})}),e.jsx($,{column:"main",blockId:"region-address",children:e.jsxs(z,{children:[e.jsx(H,{control:o.control,name:"province",render:({field:r})=>e.jsx(Te,{value:{province:r.value??"",city:o.watch("city")??"",district:o.watch("district")??"",street:o.watch("street")??""},onChange:v,hasConfigured:b,onRegionCenterChange:(S,Q)=>{Q==="district"&&(m(S),p(!0))}})}),e.jsx(k,{control:o.control,name:"address",label:e.jsx(l,{id:"1gV3ht"}),render:({field:r})=>e.jsx(q,{...r,placeholder:"点击地图自动填充，或手动输入门牌号"})})]})}),t&&e.jsx($,{column:"main",blockId:"map-picker",children:e.jsx(H,{control:o.control,name:"coordinates",render:({field:r})=>e.jsx(Ke,{ref:a,value:r.value,onChange:r.onChange,onReverseGeocode:f,initialCenter:d,initialZoom:13})})})]})]})}const Oe=I(`
    query GetPickupLocations($options: ListQueryOptions) {
        pickupLocations(options: $options) {
            items {
                id
                name
                type
                address
                phoneNumber
                businessHours
                partner
            }
            totalItems
        }
    }
`),Ee=I(`
    mutation DeletePickupLocation($id: ID!) {
        deletePickupLocation(id: $id)
    }
`),Ve={navMenuItem:{sectionId:"settings",id:"pickup-locations",url:"/pickup-locations",title:"自提点管理",requiresPermission:["ReadSettings"]},path:"/pickup-locations",loader:()=>({breadcrumb:"自提点管理"}),component:n=>e.jsx(Be,{route:n})};function Be({route:n}){const s=se(),c=R({mutationFn:t=>D.mutate(Ee,{id:t}),onSuccess:()=>{M.success("删除成功"),s.invalidateQueries()},onError:t=>{M.error("删除失败: "+(t?.message||"未知错误"))}}),a=t=>{window.confirm("确认删除此自提点?")&&c.mutate(t)};return e.jsx(ce,{pageId:"pickup-location-list",title:e.jsx(l,{id:"2pMPzL"}),listQuery:Oe,route:n,defaultVisibility:{phoneNumber:!1,businessHours:!1,partner:!1},customizeColumns:{id:{header:"ID",cell:({row:t})=>e.jsx(T,{id:t.original.id,label:t.original.id})},name:{header:e.jsx(l,{id:"+bnz4W"}),cell:({row:t})=>e.jsx(T,{id:t.original.id,label:t.original.name})},type:{header:e.jsx(l,{id:"D/FLMI"}),cell:({row:t})=>{const p={store:"门店",point:"驿站",employee:"员工自提点"};return e.jsx(T,{id:t.original.id,label:p[t.original.type]??t.original.type})}},actions:{header:e.jsx(l,{id:"5oBbwZ"}),cell:({row:t})=>e.jsx(oe,{requires:["PickupLocationDelete"],children:e.jsx(A,{variant:"ghost",size:"sm",onClick:()=>a(t.original.id),disabled:c.isPending,children:e.jsx(le,{className:"h-4 w-4"})})})}},children:e.jsx(ne,{itemId:"create-button",requiresPermission:["PickupLocationCreate"],children:e.jsxs(A,{render:e.jsx(ae,{to:"./new"}),children:[e.jsx(re,{className:"mr-2 h-4 w-4"}),e.jsx(l,{id:"ie9Wii"})]})})})}const xe=I(`
    query GetShippingProfileDetail($id: ID!) {
        shippingProfile(id: $id) {
            id
            name
            code
            description
            freeShippingThreshold
            isGlobal
            shippingMethods {
                id
                code
                name
            }
        }
    }
`),ze=I(`
    query GetShippingMethods($options: ListQueryOptions) {
        shippingMethods(options: $options) {
            items {
                id
                code
                name
            }
            totalItems
        }
    }
`),Ue=I(`
    mutation CreateShippingProfile($input: CreateShippingProfileInput!) {
        createShippingProfile(input: $input) {
            id
            name
        }
    }
`),We=I(`
    mutation UpdateShippingProfile($input: UpdateShippingProfileInput!) {
        updateShippingProfile(input: $input) {
            id
            name
        }
    }
`),He={path:"/shipping-profiles/$id",loader:J({queryDocument:xe,breadcrumb:(n,s)=>[{path:"/shipping-profiles",label:"配送档案"},n?"新建":s?.name??"详情"]}),component:n=>e.jsx(Je,{route:n})};function Je({route:n}){const s=n.useParams(),c=_(),{form:a,submitHandler:t,entity:p,isPending:d}=Z({queryDocument:xe,createDocument:Ue,updateDocument:We,params:{id:s.id},setValuesForUpdate:i=>({id:i.id,name:i.name,code:i.code,description:i.description,freeShippingThreshold:i.freeShippingThreshold,isGlobal:i.isGlobal,shippingMethodIds:i.shippingMethods?.map(x=>x.id)??[]}),onSuccess:async i=>{M.success(p?"更新成功":"创建成功"),!p&&i.id&&await c({to:"../$id",params:{id:i.id}})},onError:i=>{M.error("保存失败: "+(i?.message??"未知错误"))}}),o=L({queryKey:["shippingMethods"],queryFn:()=>D.query(ze,{options:{take:100}})}).data?.shippingMethods?.items??[],u=a.watch("shippingMethodIds")??[],j=i=>{const x=a.getValues("shippingMethodIds")??[],b=x.includes(i)?x.filter(v=>v!==i):[...x,i];a.setValue("shippingMethodIds",b,{shouldDirty:!0})};return e.jsxs(Y,{pageId:"shipping-profile-detail",form:a,submitHandler:t,children:[e.jsx(X,{children:p?.name??e.jsx(l,{id:"2/1hNY"})}),e.jsx(ee,{children:e.jsx(te,{children:e.jsx(A,{type:"submit",disabled:!a.formState.isDirty||d,children:p?e.jsx(l,{id:"jBG25x"}):e.jsx(l,{id:"lLPWZb"})})})}),e.jsxs(ie,{children:[e.jsx($,{column:"main",blockId:"basic-info",children:e.jsxs(z,{children:[e.jsx(k,{control:a.control,name:"name",label:e.jsx(l,{id:"+bnz4W"}),render:({field:i})=>e.jsx(q,{...i,placeholder:"如：冷链配送"})}),e.jsx(k,{control:a.control,name:"code",label:e.jsx(l,{id:"IbJW7O"}),render:({field:i})=>e.jsx(q,{...i,placeholder:"如：cold-chain"})}),e.jsx(k,{control:a.control,name:"description",label:e.jsx(l,{id:"9hSn8x"}),render:({field:i})=>e.jsx(q,{...i,placeholder:"描述说明"})}),e.jsx(k,{control:a.control,name:"freeShippingThreshold",label:e.jsx(l,{id:"4zMxDC"}),render:({field:i})=>e.jsx(De,{...i,value:i.value??"",placeholder:"留空则使用各配送方式自身规则"})})]})}),e.jsxs($,{column:"main",blockId:"shipping-methods",children:[e.jsx("h3",{className:"text-lg font-medium mb-2",children:e.jsx(l,{id:"9v3ULk"})}),e.jsxs("div",{className:"space-y-2 border rounded-lg p-4",children:[o.length===0&&e.jsx("p",{className:"text-gray-500 text-sm",children:e.jsx(l,{id:"+d8Frh"})}),o.map(i=>e.jsxs("label",{className:"flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded",children:[e.jsx("input",{type:"checkbox",checked:u.includes(i.id),onChange:()=>j(i.id),className:"h-4 w-4"}),e.jsxs("span",{className:"text-sm",children:[i.name," (",i.code,")"]})]},i.id))]})]})]})]})}const _e=I(`
    query GetShippingProfiles($options: ListQueryOptions) {
        shippingProfiles(options: $options) {
            items {
                id
                name
                code
                description
                freeShippingThreshold
                isGlobal
            }
            totalItems
        }
    }
`),Ze=I(`
    mutation DeleteShippingProfile($id: ID!) {
        deleteShippingProfile(id: $id)
    }
`),Ye={navMenuItem:{sectionId:"settings",id:"shipping-profiles",url:"/shipping-profiles",title:"配送档案",requiresPermission:["ReadSettings"]},path:"/shipping-profiles",loader:()=>({breadcrumb:"配送档案"}),component:n=>e.jsx(Xe,{route:n})};function Xe({route:n}){const s=se(),c=R({mutationFn:t=>D.mutate(Ze,{id:t}),onSuccess:()=>{M.success("删除成功"),s.invalidateQueries()},onError:t=>{M.error("删除失败: "+(t?.message||"未知错误"))}}),a=t=>{window.confirm("确认删除此配送档案？被引用的商品需要先重新分配")&&c.mutate(t)};return e.jsx(ce,{pageId:"shipping-profile-list",title:e.jsx(l,{id:"YLr3J7"}),listQuery:_e,route:n,customizeColumns:{id:{header:"ID",cell:({row:t})=>e.jsx(T,{id:t.original.id,label:t.original.id})},name:{header:e.jsx(l,{id:"+bnz4W"}),cell:({row:t})=>e.jsx(T,{id:t.original.id,label:t.original.name})},code:{header:e.jsx(l,{id:"IbJW7O"})},freeShippingThreshold:{header:e.jsx(l,{id:"mul4oj"}),cell:({row:t})=>e.jsx("span",{children:t.original.freeShippingThreshold??"-"})},isGlobal:{header:e.jsx(l,{id:"V/JwC3"}),cell:({row:t})=>e.jsx("span",{children:t.original.isGlobal?"是":"否"})},actions:{header:e.jsx(l,{id:"5oBbwZ"}),cell:({row:t})=>e.jsx(oe,{requires:["ShippingProfileDelete"],children:e.jsx(A,{variant:"ghost",size:"sm",onClick:()=>a(t.original.id),disabled:c.isPending,children:e.jsx(le,{className:"h-4 w-4"})})})}},children:e.jsx(ne,{itemId:"create-button",requiresPermission:["ShippingProfileCreate"],children:e.jsxs(A,{render:e.jsx(ae,{to:"./new"}),children:[e.jsx(re,{className:"mr-2 h-4 w-4"}),e.jsx(l,{id:"2/1hNY"})]})})})}const ye=I(`
    query GetPaymentProfileDetail($id: ID!) {
        paymentProfile(id: $id) {
            id
            name
            code
            description
            isGlobal
            installmentOptions
            paymentMethods {
                id
                code
                name
            }
        }
    }
`),et=I(`
    query GetPaymentMethods($options: ListQueryOptions) {
        paymentMethods(options: $options) {
            items {
                id
                code
                name
            }
            totalItems
        }
    }
`),tt=I(`
    mutation CreatePaymentProfile($input: CreatePaymentProfileInput!) {
        createPaymentProfile(input: $input) {
            id
            name
        }
    }
`),it=I(`
    mutation UpdatePaymentProfile($input: UpdatePaymentProfileInput!) {
        updatePaymentProfile(input: $input) {
            id
            name
        }
    }
`),st={path:"/payment-profiles/$id",loader:J({queryDocument:ye,breadcrumb:(n,s)=>[{path:"/payment-profiles",label:"支付档案"},n?"新建":s?.name??"详情"]}),component:n=>e.jsx(nt,{route:n})};function nt({route:n}){const s=n.useParams(),c=_(),{form:a,submitHandler:t,entity:p,isPending:d}=Z({queryDocument:ye,createDocument:tt,updateDocument:it,params:{id:s.id},setValuesForUpdate:i=>({id:i.id,name:i.name,code:i.code,description:i.description,isGlobal:i.isGlobal,installmentOptions:i.installmentOptions,paymentMethodIds:i.paymentMethods?.map(x=>x.id)??[]}),onSuccess:async i=>{M.success(p?"更新成功":"创建成功"),!p&&i.id&&await c({to:"../$id",params:{id:i.id}})},onError:i=>{M.error("保存失败: "+(i?.message??"未知错误"))}}),o=L({queryKey:["paymentMethods"],queryFn:()=>D.query(et,{options:{take:100}})}).data?.paymentMethods?.items??[],u=a.watch("paymentMethodIds")??[],j=i=>{const x=a.getValues("paymentMethodIds")??[],b=x.includes(i)?x.filter(v=>v!==i):[...x,i];a.setValue("paymentMethodIds",b,{shouldDirty:!0})};return e.jsxs(Y,{pageId:"payment-profile-detail",form:a,submitHandler:t,children:[e.jsx(X,{children:p?.name??e.jsx(l,{id:"IaE4wv"})}),e.jsx(ee,{children:e.jsx(te,{children:e.jsx(A,{type:"submit",disabled:!a.formState.isDirty||d,children:p?e.jsx(l,{id:"jBG25x"}):e.jsx(l,{id:"lLPWZb"})})})}),e.jsxs(ie,{children:[e.jsx($,{column:"main",blockId:"basic-info",children:e.jsxs(z,{children:[e.jsx(k,{control:a.control,name:"name",label:e.jsx(l,{id:"+bnz4W"}),render:({field:i})=>e.jsx(q,{...i,placeholder:"如：线上支付"})}),e.jsx(k,{control:a.control,name:"code",label:e.jsx(l,{id:"IbJW7O"}),render:({field:i})=>e.jsx(q,{...i,placeholder:"如：online-payment"})}),e.jsx(k,{control:a.control,name:"description",label:e.jsx(l,{id:"9hSn8x"}),render:({field:i})=>e.jsx(q,{...i,placeholder:"描述说明"})}),e.jsx(k,{control:a.control,name:"isGlobal",label:e.jsx(l,{id:"lBnyu9"}),render:({field:i})=>e.jsx(ue,{...i})})]})}),e.jsxs($,{column:"main",blockId:"payment-methods",children:[e.jsx("h3",{className:"text-lg font-medium mb-2",children:e.jsx(l,{id:"uAEFxK"})}),e.jsxs("div",{className:"space-y-2 border rounded-lg p-4",children:[o.length===0&&e.jsx("p",{className:"text-gray-500 text-sm",children:e.jsx(l,{id:"+d8Frh"})}),o.map(i=>e.jsxs("label",{className:"flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded",children:[e.jsx("input",{type:"checkbox",checked:u.includes(i.id),onChange:()=>j(i.id),className:"h-4 w-4"}),e.jsxs("span",{className:"text-sm",children:[i.name," (",i.code,")"]})]},i.id))]})]}),e.jsxs($,{column:"main",blockId:"installment-options",children:[e.jsx("h3",{className:"text-lg font-medium mb-2",children:e.jsx(l,{id:"KuUhHk"})}),e.jsx("p",{className:"text-sm text-gray-500 mb-2",children:e.jsx(l,{id:"jCT3gS"})}),e.jsx(H,{control:a.control,name:"installmentOptions",render:({field:i})=>e.jsx("textarea",{className:"w-full border rounded px-3 py-2 text-sm font-mono h-24",value:i.value?JSON.stringify(i.value,null,2):"",onChange:x=>{try{i.onChange(JSON.parse(x.target.value))}catch{i.onChange(x.target.value)}},placeholder:'{"alipay":{"huabei":{"periods":[3,6,12]}}}'})})]})]})]})}const rt=I(`
    query GetPaymentProfiles($options: ListQueryOptions) {
        paymentProfiles(options: $options) {
            items {
                id
                name
                code
                description
                isGlobal
            }
            totalItems
        }
    }
`),at=I(`
    mutation DeletePaymentProfile($id: ID!) {
        deletePaymentProfile(id: $id)
    }
`),ot={navMenuItem:{sectionId:"settings",id:"payment-profiles",url:"/payment-profiles",title:"支付档案",requiresPermission:["ReadSettings"]},path:"/payment-profiles",loader:()=>({breadcrumb:"支付档案"}),component:n=>e.jsx(lt,{route:n})};function lt({route:n}){const s=se(),c=R({mutationFn:t=>D.mutate(at,{id:t}),onSuccess:()=>{M.success("删除成功"),s.invalidateQueries()},onError:t=>{M.error("删除失败: "+(t?.message||"未知错误"))}}),a=t=>{window.confirm("确认删除此支付档案？被引用的商品需要先重新分配")&&c.mutate(t)};return e.jsx(ce,{pageId:"payment-profile-list",title:e.jsx(l,{id:"u4Iq+W"}),listQuery:rt,route:n,customizeColumns:{id:{header:"ID",cell:({row:t})=>e.jsx(T,{id:t.original.id,label:t.original.id})},name:{header:e.jsx(l,{id:"+bnz4W"}),cell:({row:t})=>e.jsx(T,{id:t.original.id,label:t.original.name})},code:{header:e.jsx(l,{id:"IbJW7O"})},isGlobal:{header:e.jsx(l,{id:"V/JwC3"}),cell:({row:t})=>e.jsx("span",{children:t.original.isGlobal?"是":"否"})},actions:{header:e.jsx(l,{id:"5oBbwZ"}),cell:({row:t})=>e.jsx(oe,{requires:["PaymentProfileDelete"],children:e.jsx(A,{variant:"ghost",size:"sm",onClick:()=>a(t.original.id),disabled:c.isPending,children:e.jsx(le,{className:"h-4 w-4"})})})}},children:e.jsx(ne,{itemId:"create-button",requiresPermission:["PaymentProfileCreate"],children:e.jsxs(A,{render:e.jsx(ae,{to:"./new"}),children:[e.jsx(re,{className:"mr-2 h-4 w-4"}),e.jsx(l,{id:"IaE4wv"})]})})})}const ct=I(`
    query TenantConfig($channelId: ID!) {
        tenantConfig(channelId: $channelId) {
            channelId
            auth
            pay
            map
            canEdit
        }
    }
`),dt=I(`
    mutation UpdateTenantConfig($input: UpdateTenantConfigInput!) {
        updateTenantConfig(input: $input) {
            channelId
            auth
            pay
            map
            canEdit
        }
    }
`),pt=I(`
    mutation TestSso($input: TestSsoInput!) {
        testSsoConnection(input: $input) {
            success
            latencyMs
            error
        }
    }
`);function ut(n){const s=L({queryKey:["tenantConfig",n],queryFn:()=>D.query(ct,{channelId:n})}),c=R({mutationFn:t=>D.mutate(dt,{input:{channelId:n,...t}})}),a=R({mutationFn:t=>D.mutate(pt,{input:{channelId:n,...t}})});return{data:s.data?.tenantConfig,loading:s.isLoading,error:s.error,refetch:s.refetch,update:t=>c.mutateAsync(t),testSso:(t,p)=>a.mutateAsync({providerKey:t,newClientSecret:p})}}function K({title:n,children:s}){return e.jsxs("div",{style:{border:"1px solid #e0e0e0",borderRadius:4,padding:16,marginBottom:16},children:[e.jsx("h3",{style:{marginTop:0},children:n}),s]})}function P({label:n,value:s,onCommit:c,placeholder:a,disabled:t}){const[p,d]=g.useState(""),[m]=g.useState(!!s);g.useEffect(()=>{d("")},[s]);const o=m&&!p?"********":p;return e.jsxs("div",{children:[e.jsx("label",{children:n}),e.jsx("input",{type:"text",value:o,placeholder:a||(m?"留空保存表示保留原值":""),disabled:t,onChange:u=>d(u.target.value),onBlur:()=>{m?c(p===""?"***":p):p&&c(p)}}),m&&!t&&e.jsx("button",{type:"button",onClick:()=>c(""),children:"清空"})]})}function mt({data:n,canEdit:s,onSave:c}){const a=(t,p,d)=>{c({payPatch:{[t]:{[p]:d}}})};return e.jsxs("div",{children:[e.jsxs(K,{title:"微信支付",children:[e.jsx(P,{label:"appId",value:n?.wechatpay?.appId,disabled:!s,onCommit:t=>a("wechatpay","appId",t)}),e.jsx(P,{label:"mchId",value:n?.wechatpay?.mchId,disabled:!s,onCommit:t=>a("wechatpay","mchId",t)}),e.jsx(P,{label:"privateKey",value:n?.wechatpay?.privateKey,disabled:!s,onCommit:t=>a("wechatpay","privateKey",t)}),e.jsx(P,{label:"apiKey",value:n?.wechatpay?.apiKey,disabled:!s,onCommit:t=>a("wechatpay","apiKey",t)}),e.jsx(P,{label:"serialNo",value:n?.wechatpay?.serialNo,disabled:!s,onCommit:t=>a("wechatpay","serialNo",t)}),e.jsx(P,{label:"publicKey",value:n?.wechatpay?.publicKey,disabled:!s,onCommit:t=>a("wechatpay","publicKey",t)})]}),e.jsxs(K,{title:"抖音支付",children:[e.jsx(P,{label:"appId",value:n?.douyinpay?.appId,disabled:!s,onCommit:t=>a("douyinpay","appId",t)}),e.jsx(P,{label:"appSecret",value:n?.douyinpay?.appSecret,disabled:!s,onCommit:t=>a("douyinpay","appSecret",t)}),e.jsx(P,{label:"mchId",value:n?.douyinpay?.mchId,disabled:!s,onCommit:t=>a("douyinpay","mchId",t)}),e.jsx(P,{label:"privateKey",value:n?.douyinpay?.privateKey,disabled:!s,onCommit:t=>a("douyinpay","privateKey",t)}),e.jsx(P,{label:"salt",value:n?.douyinpay?.salt,disabled:!s,onCommit:t=>a("douyinpay","salt",t)})]}),e.jsxs(K,{title:"支付宝",children:[e.jsx(P,{label:"appId",value:n?.alipay?.appId,disabled:!s,onCommit:t=>a("alipay","appId",t)}),e.jsx(P,{label:"privateKey",value:n?.alipay?.privateKey,disabled:!s,onCommit:t=>a("alipay","privateKey",t)})]})]})}function ht({data:n,canEdit:s,onSave:c}){const a=n?.overrides?.wechat||{},t=(d,m)=>{c({authPatch:{overrides:{wechat:{[d]:m}}}})},p=d=>{const m=new Set(n?.enabledMethods||[]);d?m.add("wechat"):m.delete("wechat"),c({authPatch:{enabledMethods:Array.from(m)}})};return e.jsxs("div",{children:[e.jsx(K,{title:"启用状态",children:e.jsxs("label",{children:[e.jsx("input",{type:"checkbox",checked:(n?.enabledMethods||[]).includes("wechat"),disabled:!s,onChange:d=>p(d.target.checked)}),"启用微信登录"]})}),e.jsxs(K,{title:"公众号配置",children:[e.jsx(P,{label:"appId",value:a.appId,disabled:!s,onCommit:d=>t("appId",d)}),e.jsx(P,{label:"appSecret",value:a.appSecret,disabled:!s,onCommit:d=>t("appSecret",d)}),e.jsx(P,{label:"token(消息校验)",value:a.token,disabled:!s,onCommit:d=>t("token",d)}),e.jsx(P,{label:"encodingAESKey(通信加密密钥)",value:a.encodingAESKey,disabled:!s,onCommit:d=>t("encodingAESKey",d)})]}),e.jsxs(K,{title:"小程序配置",children:[e.jsx(P,{label:"miniProgramAppId",value:a.miniProgramAppId,disabled:!s,onCommit:d=>t("miniProgramAppId",d)}),e.jsx(P,{label:"miniProgramAppSecret",value:a.miniProgramAppSecret,disabled:!s,onCommit:d=>t("miniProgramAppSecret",d)})]})]})}function xt({data:n,canEdit:s,onSave:c,onTest:a}){const t=n?.ssoProviders||[],[p,d]=g.useState(null),[m,o]=g.useState(null),u=async i=>{d(i),o(null);const x=await a(i);o(x?.data?.testSsoConnection),d(null)},j=(i,x,b)=>{const v=[...t];v[i]={...v[i],[x]:b},c({authPatch:{ssoProviders:v}})};return e.jsxs("div",{children:[e.jsx("div",{style:{background:"#fff3cd",padding:8,marginBottom:16},children:"提示: Strapi 侧 sso-app 需在 zhao-sso 插件管理面板同步配置 app_code/app_secret/redirect_uris"}),t.map((i,x)=>e.jsxs(K,{title:`SSO Provider: ${i.name}`,children:[e.jsx(P,{label:"name",value:i.name,disabled:!s,onCommit:b=>j(x,"name",b)}),e.jsx(P,{label:"providerKey",value:i.providerKey,disabled:!s,onCommit:b=>j(x,"providerKey",b)}),e.jsxs("div",{children:[e.jsx("label",{children:"protocol"}),e.jsxs("select",{value:i.protocol,disabled:!s,onChange:b=>j(x,"protocol",b.target.value),children:[e.jsx("option",{value:"zhao-sso",children:"zhao-sso"}),e.jsx("option",{value:"oauth2",children:"oauth2"})]})]}),e.jsx(P,{label:"baseUrl",value:i.baseUrl,disabled:!s,onCommit:b=>j(x,"baseUrl",b)}),e.jsx(P,{label:"clientId(app_code)",value:i.clientId,disabled:!s,onCommit:b=>j(x,"clientId",b)}),e.jsx(P,{label:"clientSecret(app_secret)",value:i.clientSecret,disabled:!s,onCommit:b=>j(x,"clientSecret",b)}),e.jsx(P,{label:"channelCode",value:i.channelCode,disabled:!s,onCommit:b=>j(x,"channelCode",b)}),e.jsx("button",{onClick:()=>u(i.providerKey),disabled:!s||p===i.providerKey,children:p===i.providerKey?"测试中...":"测试连通性"}),m&&e.jsxs("div",{style:{marginTop:8},children:["结果: ",m.success?"✅ 成功":"❌ 失败"," (",m.latencyMs,"ms)",m.error&&e.jsxs("div",{children:["错误: ",m.error]})]})]},i.providerKey))]})}function yt({data:n,canEdit:s,onSave:c}){const a=(t,p)=>{c({mapPatch:{[t]:p}})};return e.jsxs(K,{title:"地图配置",children:[e.jsxs("div",{children:[e.jsx("label",{children:"provider"}),e.jsxs("select",{value:n?.provider,disabled:!s,onChange:t=>a("provider",t.target.value),children:[e.jsx("option",{value:"amap",children:"高德(amap)"}),e.jsx("option",{value:"tencent",children:"腾讯(tencent)"}),e.jsx("option",{value:"baidu",children:"百度(baidu)"})]})]}),e.jsx(P,{label:"apiKey",value:n?.apiKey,disabled:!s,onCommit:t=>a("apiKey",t)}),n?.provider==="amap"&&e.jsx(P,{label:"securityJsCode",value:n?.securityJsCode,disabled:!s,onCommit:t=>a("securityJsCode",t)})]})}function gt({channelId:n}){const[s,c]=g.useState("payment"),{data:a,loading:t,error:p,update:d,testSso:m}=ut(n);return t?e.jsx("div",{children:"加载中..."}):p?e.jsxs("div",{children:["错误: ",p.message]}):a?e.jsxs("div",{style:{marginTop:24},children:[e.jsx("h2",{children:"租户配置中心"}),!a.canEdit&&e.jsx("div",{style:{color:"orange"},children:"无权编辑此租户配置"}),e.jsx("div",{style:{display:"flex",gap:8,borderBottom:"1px solid #ccc",marginBottom:16},children:[["payment","支付"],["wechat-auth","微信登录"],["sso","SSO"],["map","地图"]].map(([o,u])=>e.jsx("button",{onClick:()=>c(o),style:{padding:"8px 16px",fontWeight:s===o?"bold":"normal",borderBottom:s===o?"2px solid #1976d2":"none"},children:u},o))}),s==="payment"&&e.jsx(mt,{data:a.pay,canEdit:a.canEdit,onSave:d}),s==="wechat-auth"&&e.jsx(ht,{data:a.auth,canEdit:a.canEdit,onSave:d}),s==="sso"&&e.jsx(xt,{data:a.auth,canEdit:a.canEdit,onSave:d,onTest:m}),s==="map"&&e.jsx(yt,{data:a.map,canEdit:a.canEdit,onSave:d})]}):null}function jt({context:n}){const s=n.entity?.id;return s?e.jsx(gt,{channelId:String(s)}):null}Me({routes:[Ve,Re,Ye,He,ot,st],detailForms:[...qe,...Le],pageBlocks:[{id:"tenant-config-center",title:"租户配置中心",location:{pageId:"channel-detail",column:"main",position:{blockId:"custom-fields",order:"after"}},component:jt}]});
