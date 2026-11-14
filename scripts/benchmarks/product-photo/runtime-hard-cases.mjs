// Real runtime evaluation, private disposable model process, no Bazaar database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import sharp from 'sharp';
const root=resolve('.local/photo-search-benchmark');
const out=resolve('.local/product-photo-hard-cases');await mkdir(out,{recursive:true});
const pairs=[[259,262],[577,617],[543,546],[609,618],[143,19],[208,321]];
const ids=pairs.flat(); const threshold=0.68;
const manifest=JSON.parse(await readFile(`${root}/dataset.json`,'utf8'));
const catalog=manifest.entries.filter(r=>ids.includes(Number(r.product_id.slice(5))) && r.split==='gallery');
const queries=manifest.entries.filter(r=>ids.includes(Number(r.product_id.slice(5))) && r.split==='test');
assert.equal(catalog.length,24);assert.equal(queries.length,60);
const token=randomBytes(32).toString('hex');const base='http://127.0.0.1:3161';
const model='ppshitu-v2-pplcnetv2-v1-fp32-224';
const log=await open(`${out}/runtime-service.log`,'w');
const service=spawn(`${root}/venv/bin/python`,['services/product-photo-search/server.py','--model-dir',`${root}/models/general_PPLCNetV2_base_pretrained_v1.0_infer`,'--port','3161','--threads','1'],{env:{PATH:process.env.PATH,PRODUCT_PHOTO_SEARCH_TOKEN:token,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'},stdio:['ignore',log.fd,log.fd]});
let serviceError;
// Observe termination before startup: cleanup must also finish if Python cannot start.
const serviceClosed=new Promise(resolve=>service.once('close',resolve));
service.once('error',error=>{serviceError=error;});
const call=async(path,body)=>{
 const response=await fetch(`${base}/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.modelVersion,model);return result;
};
const canonical=async(row)=>{
 const data=await readFile(`${root}/${row.path}`);assert.equal(createHash('sha256').update(data).digest('hex'),row.sha256);
 return (await sharp(data,{pages:1,limitInputPixels:40000000}).rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).flatten({background:'white'}).jpeg({quality:90}).toBuffer()).toString('base64');
};
const pack=rows=>{const buf=Buffer.alloc(rows.length*512*4);rows.forEach((v,i)=>v.forEach((n,j)=>buf.writeFloatLE(n,(i*512+j)*4)));return buf.toString('base64');};
try {
 const deadline=Date.now()+30000;
 while(true) {if(serviceError)throw serviceError;if(service.exitCode!==null)throw new Error('Model service exited; inspect runtime-service.log');try{await call('health');break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(r=>setTimeout(r,200));}}
 const embeddings=[];
 for(const row of catalog) {const result=await call('embed',{imageBase64:await canonical(row)});assert.equal(result.embedding.length,512);embeddings.push(result.embedding);}
 const unique=[...new Set(catalog.map(r=>r.product_id))];const groups=catalog.map(r=>unique.indexOf(r.product_id));
 const matrix=pack(embeddings);const results=[];
 for(const row of queries) {
  const imageBase64=await canonical(row);
  const response=await call('search',{imageBase64,vectorsBase64:matrix,groups});
  const map=matches=>matches.map(m=>({...m,productId:catalog[m.index].product_id}));
  const matches=map(response.matches);assert.equal(new Set(matches.map(m=>m.productId)).size,matches.length);
  const remaining=catalog.map((item,i)=>({...item,vector:embeddings[i],group:groups[i]})).filter(r=>r.product_id!==row.product_id);
  const absent=await call('search',{imageBase64,vectorsBase64:pack(remaining.map(r=>r.vector)),groups:remaining.map(r=>r.group)});
  results.push({id:row.id,productId:row.product_id,condition:row.condition,matches,
   absentMatches:absent.matches.map(m=>({...m,productId:remaining[m.index].product_id}))});
 }
 const duplicate=await call('search',{imageBase64:await canonical(catalog[0]),vectorsBase64:pack([embeddings[0],embeddings[0]]),groups:[0,1]});
 assert.equal(duplicate.matches.length,2);assert.ok(duplicate.matches.every(m=>m.score>0.999));
 const summary={schema:1,model,threshold,pairs,products:unique.length,galleryPhotos:catalog.length,heldOutQueries:results.length,
  rawTop1:results.filter(r=>r.matches[0]?.productId===r.productId).length/results.length,
  visibleTop5:results.filter(r=>r.matches.slice(0,5).some(m=>m.productId===r.productId&&m.score>=threshold)).length/results.length,
  visibleWrongTop1:results.filter(r=>r.matches[0]?.productId!==r.productId&&r.matches[0]?.score>=threshold).length/results.length,
  absentCandidateRate:results.filter(r=>r.absentMatches.some(m=>m.score>=threshold)).length/results.length,
  identicalPhotoDifferentSku:{candidates:duplicate.matches.length,scores:duplicate.matches.map(m=>m.score),distinguishable:false},
  limits:['Curated 12 public ALOI objects; 154x115 previews, not Bazaar SKU accuracy','Real pinned runtime and Faiss, Node canonicalization; no database or user gallery changes','Same input pixels for duplicate-SKU ambiguity is a protocol test, not independent photographic evidence'],results};
 await writeFile(`${out}/runtime.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,results:undefined},null,2));
} finally {
 if(service.exitCode===null && service.signalCode===null)service.kill('SIGTERM');
 const force=setTimeout(()=>service.kill('SIGKILL'),5000);
 try {await serviceClosed;} finally {clearTimeout(force);await log.close();}
}
