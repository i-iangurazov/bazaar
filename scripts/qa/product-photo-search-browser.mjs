// Real end-to-end search on disposable local records and public ALOI images.
import assert from "node:assert/strict";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
const base = "http://localhost:3158";
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
const out = ".local/product-photo-search/browser";
await mkdir(out, { recursive: true });
const [identity] = await db.$queryRaw`SELECT current_database() AS database, current_user AS username, inet_server_port() AS port`;
assert.equal(identity.database, "bazaar_hardening_agent4_platform"); assert.equal(identity.username, "bazaar_test"); assert.equal(identity.port, 55991);
const org = await db.organization.upsert({ where: { id: "photo-search-browser-qa" }, update: {}, create: { id: "photo-search-browser-qa", name: "Photo QA", plan: "STARTER" } });
const unit = await db.unit.upsert({ where: { organizationId_code: { organizationId: org.id, code: "each" } }, update: {}, create: { organizationId: org.id, code: "each", labelRu: "шт", labelKg: "даана" } });
const stores = [];
for (const [id,name] of [["photo-search-browser-shop", "Тестовый магазин"],["photo-search-browser-other", "Другой магазин"]]) stores.push(await db.store.upsert({ where: { id }, update: {}, create: { id, organizationId: org.id, name, code: id, currencyCode: "KGS" } }));
const users=[];
for(const role of ["STAFF","CASHIER"]){
 const user=await db.user.upsert({where:{email:`photo-search-${role.toLowerCase()}@example.invalid`},update:{},create:{organizationId:org.id,email:`photo-search-${role.toLowerCase()}@example.invalid`,name:`Photo ${role}`,passwordHash:"qa-not-a-real-password",role,emailVerifiedAt:new Date(),preferredLocale:"ru"}}); users.push(user);
 await db.userStoreAccess.createMany({data:stores.map(store=>({organizationId:org.id,userId:user.id,storeId:store.id})),skipDuplicates:true});
}
const photos = "public/uploads/product-photo-browser-qa";
await mkdir(photos,{recursive:true});
for (const [object,name] of [[103,"Футбольный мяч"],[482,"Синяя машинка"],[577,"Банка"],[688,"Коробка лампочки"]]) {
 const id = `photo-search-browser-product-${object}`;
 for(const condition of ["r0","r90"]) await copyFile(`.local/photo-search-benchmark/images/${object}/${object}_${condition}.jpg`, `${photos}/${object}_${condition}.jpg`);
 await db.product.upsert({where:{id},update:{},create:{id,organizationId:org.id,name,sku:`ALOI-${object}`,unit:"each",baseUnitId:unit.id,basePriceKgs:object,photoUrl:`/uploads/product-photo-browser-qa/${object}_r0.jpg`}});
 await db.storeProduct.upsert({where:{storeId_productId:{storeId:stores[0].id,productId:id}},update:{isActive:true,isHidden:false},create:{organizationId:org.id,storeId:stores[0].id,productId:id,isActive:true}});
 for(const [position,condition] of ["r0","r90"].entries()) await db.productImage.upsert({where:{id:`${id}-${condition}`},update:{},create:{id:`${id}-${condition}`,organizationId:org.id,productId:id,url:`/uploads/product-photo-browser-qa/${object}_${condition}.jpg`,position}});
}
await db.$disconnect();
if (process.argv.includes("--seed-only")) { console.log("Isolated photo search browser fixtures prepared"); process.exit(0); }
const cookie = async (user) => ({name:"__Secure-next-auth.session-token",secure:true,value:await encode({secret:"disposable-product-photo-search-secret",token:{sub:user.id,email:user.email,name:user.name,role:user.role,organizationId:user.organizationId,sessionVersion:user.sessionVersion}}),url:base.replace("http:","https:")});
const browser = await chromium.launch({headless:true,channel:"chrome"});
const errors=[],checks=[];
try {
 for(const viewport of [{width:1440,height:1050},{width:390,height:844}]) {
  const context=await browser.newContext({viewport,locale:"ru-RU"});
  await context.route("**/*",route=>["localhost","127.0.0.1"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await context.addCookies([await cookie(users[1]),{name:"NEXT_LOCALE",value:"ru",url:base}]);
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`${base}/products?storeId=${stores[0].id}`);
  await page.screenshot({path:`${out}/loaded-${viewport.width}.png`,fullPage:false});
  await writeFile(`${out}/loaded-${viewport.width}.txt`,await page.locator("body").innerText());
  await page.getByRole("button",{name:"Поиск по фото",exact:true}).click();
  await page.getByText("Поиск только в ассортименте магазина «Тестовый магазин».").waitFor();
  await page.screenshot({path:`${out}/initial-${viewport.width}.png`,fullPage:false});
  assert.equal(await page.locator('input[capture="environment"]').count(),1);
  await page.getByLabel("Загрузить фото",{exact:true}).setInputFiles(".local/photo-search-benchmark/images/103/103_r30.jpg");
  await page.getByRole("button",{name:"Найти похожие",exact:true}).click();
  await page.getByRole("button",{name:"Выбрать товар «Футбольный мяч»"}).waitFor({timeout:90000});
  assert.equal(new URL(page.url()).pathname,"/products");
  const dialog=page.getByRole("dialog",{name:"Найти товар по фотографии"});
  await dialog.getByText("Футбольный мяч",{exact:true}).click();
  assert.equal(new URL(page.url()).pathname,"/products");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await page.screenshot({path:`${out}/results-${viewport.width}.png`,fullPage:false});
  await writeFile(`${out}/results-${viewport.width}.txt`,await dialog.innerText());
  await page.getByRole("button",{name:"Выбрать товар «Футбольный мяч»"}).click();
  await page.waitForURL(`**/products/photo-search-browser-product-103?**`);
  checks.push({viewport,role:"CASHIER",plan:"STARTER",realPPShiTuFaiss:true,heldOutPhoto:"103_r30",manualChoice:true,noOverflow:true});
  await context.close();
 }
 console.log("Real desktop/mobile search and card selection passed");
 for(const [locale,open,empty] of [["en","Search by photo","There are no products with photos in this store’s assortment yet."],["kg","Сүрөт аркылуу издөө","Бул дүкөндүн ассортиментинде сүрөтү бар товарлар азырынча жок."]]) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route("**/*",route=>["localhost","127.0.0.1"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await context.addCookies([await cookie(users[1]),{name:"NEXT_LOCALE",value:locale,url:base}]);
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`${base}/products?storeId=${stores[1].id}`);await page.getByRole("button",{name:open,exact:true}).click();
  const label=locale==="en"?"Upload a photo":"Сүрөт жүктөө";
  await page.getByLabel(label,{exact:true}).setInputFiles(".local/photo-search-benchmark/images/103/103_r30.jpg");
  await page.getByRole("button",{name:locale==="en"?"Find similar":"Окшошторун табуу",exact:true}).click();
  await page.getByText(empty,{exact:true}).waitFor();
  await page.screenshot({path:`${out}/empty-${locale}-390.png`,fullPage:false});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  checks.push({locale,role:"CASHIER",plan:"STARTER",otherStoreEmpty:true,noOverflow:true}); await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route("**/*",route=>["localhost","127.0.0.1"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await context.addCookies([await cookie(users[0]),{name:"NEXT_LOCALE",value:"ru",url:base}]);
 const page=await context.newPage();
 await page.goto(`${base}/pos?store=${stores[0].id}`);
 await page.getByRole("button",{name:"Поиск по фото",exact:true}).click();
 await page.getByLabel("Загрузить фото",{exact:true}).setInputFiles(".local/photo-search-benchmark/images/103/103_r30.jpg");
 await page.getByRole("button",{name:"Найти похожие",exact:true}).click();
 await page.getByRole("button",{name:"Выбрать товар «Футбольный мяч»"}).click();
 await page.getByText("Выбранный товар",{exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,"/pos");
 await page.screenshot({path:`${out}/selected-staff-390.png`,fullPage:false});
 checks.push({role:"STAFF",readOnlySelectionInPos:true,realPPShiTuFaiss:true});
 await context.close();
 assert.deepEqual(errors,[]);
 await writeFile(`${out}/checks.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
} finally {await browser.close();}
