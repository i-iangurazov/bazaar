"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";

type Line = {productId:string;variantId:string|null;name:string;qty:number};
export function PosTransferDialog({open,onOpenChange,storeId,registerId,stores,onSuccess}: {open:boolean;onOpenChange:(open:boolean)=>void;storeId:string;registerId:string;stores:Array<{id:string;name:string}>;onSuccess:()=>void}) {
  const t=useTranslations("pos.tools"); const errors=useTranslations("errors"); const utils=trpc.useUtils();
  const [search,setSearch]=useState(""); const [recipient,setRecipient]=useState(""); const [lines,setLines]=useState<Line[]>([]);
  const [variants,setVariants]=useState<{productId:string;name:string;variants:Array<{id:string;name:string|null;sku:string|null}>}|null>(null);
  const [message,setMessage]=useState(""); const key=useRef<string|null>(null);
  const searchInputRef=useRef<HTMLInputElement>(null);
  const focusSearch=()=>window.requestAnimationFrame(()=>{searchInputRef.current?.focus();searchInputRef.current?.select();});
  const [submitted,setSubmitted]=useState(false); const [lookupError,setLookupError]=useState("");
  const products=trpc.products.list.useQuery({storeId,search,pageSize:20},{enabled:open&&Boolean(storeId),keepPreviousData:false});
  const transfer=trpc.posTools.transfer.useMutation({onSuccess:()=>{setMessage(t("transferSuccess",{store:stores.find(store=>store.id===recipient)?.name??""}));setLines([]);key.current=null;setSubmitted(false);onSuccess();focusSearch();},onError:(error)=>{if(error.data?.httpStatus&&error.data.httpStatus<500&&!["requestInProgress","idempotencyKeyPayloadMismatch"].includes(error.message)){setSubmitted(false);key.current=null;}}});
  useEffect(()=>{setSearch("");setRecipient("");setLines([]);setVariants(null);setMessage("");key.current=null;setSubmitted(false);},[storeId,registerId]);
  useEffect(()=>{if(!open)return;const frame=window.requestAnimationFrame(()=>{searchInputRef.current?.focus();searchInputRef.current?.select();});return()=>window.cancelAnimationFrame(frame);},[open]);
  const append=(line:Line)=>{setLines(current=>{const existing=current.findIndex(row=>row.productId===line.productId&&row.variantId===line.variantId);return existing<0?[...current,line]:current.map((row,index)=>index===existing?{...row,qty:row.qty+1}:row);});setVariants(null);setSearch("");setMessage("");focusSearch();};
  const add=async(product:{id:string;name:string})=>{try {const detail=await utils.products.getById.fetch({productId:product.id});if(detail?.variants.length)setVariants({productId:product.id,name:product.name,variants:detail.variants});else append({productId:product.id,variantId:null,name:product.name,qty:1});setLookupError("");}catch(error){setLookupError(error instanceof Error?error.message:"genericMessage");}};
  const submitSearch=async()=>{try{const result=await utils.products.list.fetch({storeId,search:search.trim(),pageSize:20});if(result.items.length===1)await add(result.items[0]!);}catch(error){setLookupError(error instanceof Error?error.message:"genericMessage");}};

  return <Modal open={open} onOpenChange={onOpenChange} title={t("transferTitle")} subtitle={t("transferPolicy")} mobileSheet>
    <div className="space-y-4">
      <label className="block space-y-1 text-sm">{t("recipient")}<select aria-label={t("recipient")} className="h-10 w-full rounded-md border border-border bg-background px-3" value={recipient} onChange={e=>setRecipient(e.target.value)} disabled={transfer.isLoading||submitted}>
        <option value="">{t("chooseStore")}</option>{stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}
      </select></label>
      <Input ref={searchInputRef} autoFocus aria-label={t("productSearch")} placeholder={t("productSearch")} value={search} disabled={transfer.isLoading||submitted} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.stopPropagation();void submitSearch();}}}/>
      <div className="max-h-40 overflow-y-auto rounded-md border border-border">{products.data?.items.map(product=><button key={product.id} className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 text-left text-sm" disabled={transfer.isLoading||submitted} onClick={()=>void add(product)}><span>{product.name}</span><span className="shrink-0 text-xs text-muted-foreground">{product.onHandQty} {product.unit}</span></button>)}</div>
      {variants?<div className="space-y-2"><p className="text-sm font-medium">{variants.name}</p>{variants.variants.map(variant=><Button key={variant.id} variant="secondary" disabled={submitted} onClick={()=>append({productId:variants.productId,variantId:variant.id,name:`${variants.name} · ${variant.name??variant.sku??""}`,qty:1})}>{variant.name??variant.sku}</Button>)}</div>:null}
      {lines.map((line,index)=><div key={`${line.productId}:${line.variantId}`} className="flex items-center gap-2"><span className="min-w-0 flex-1 text-sm">{line.name}</span><Input aria-label={t("quantity")} className="w-20" type="number" min={1} step={1} value={line.qty} disabled={transfer.isLoading||submitted} onChange={e=>setLines(current=>current.map((row,i)=>i===index?{...row,qty:Number(e.target.value)}:row))}/><Button variant="ghost" aria-label={t("removeLine")} disabled={transfer.isLoading||submitted} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>×</Button></div>)}
      {lookupError?<p role="alert" className="text-sm text-danger">{errors.has(lookupError)?errors(lookupError):errors("genericMessage")}</p>:null}
      {submitted&&transfer.error?<p className="text-sm">{t("retrySameTransfer")}</p>:null}
      {transfer.error?<p role="alert" className="text-sm text-danger">{reportError(errors,transfer.error)}</p>:null}
      {message?<p role="status" className="text-sm text-success">{message}</p>:null}
      <ModalFooter><Button variant="ghost" onClick={()=>onOpenChange(false)}>{t("close")}</Button><Button disabled={transfer.isLoading||!recipient||!lines.length||lines.some(line=>!Number.isInteger(line.qty)||line.qty<=0)} onClick={()=>{key.current??=crypto.randomUUID();setSubmitted(true);transfer.mutate({registerId,toStoreId:recipient,lines:lines.map(({productId,variantId,qty})=>({productId,variantId,qty})),idempotencyKey:key.current});}}>{t("transferConfirm")}</Button></ModalFooter>
    </div>
  </Modal>;
}
