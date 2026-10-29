// Native PostgreSQL 17, disposable CI database only. Does not connect to Supabase.
import pg from 'pg';
import assert from 'node:assert/strict';
const clients=[];
const connect=async()=>{const c=new pg.Client({connectionString:process.env.PGURL});await c.connect();clients.push(c);return c;};
const one=async(c,sql,p=[])=> (await c.query(sql,p)).rows[0];
const rpc=async(c,name,...p)=>(await one(c,`select to_jsonb(x) r from public.${name}(${p.map((_,i)=>`$${i+1}`).join(',')}) x`,p.map(x=>typeof x==='object'?JSON.stringify(x):x))).r;
let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log(`PASS WORKFLOW-DB-${passed}: ${name}`);};
const rejects=async fn=>{let error;try{await fn();}catch(e){error=e;}assert.ok(error,'database must reject');};
const adminId='00000000-0000-4000-8000-000000000071',opId='00000000-0000-4000-8000-000000000072';
try{
 const su=await connect(),a=await connect(),b=await connect();
 for(const [id,role] of [[adminId,'admin'],[opId,'operator']]){await su.query('insert into auth.users(id,email) values($1,$2)',[id,`${role}@workflow.invalid`]);await su.query("update public.profiles set role=$2,status='active' where id=$1",[id,role]);}
 const as=async(c,id)=>{await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);await c.query('set role authenticated');};
 await as(a,adminId);await as(b,opId);
 const cat=await one(a,"insert into public.categories(name,code_prefix,uses_meter,supports_fuel,default_fuel_rate) values('workflow','WFA',false,false,12) returning *");
 const asset=await rpc(a,'create_asset',{category_id:cat.id,name:'workflow'},{});
 await check('asset defaults are captured and stay independent',async()=>{assert.equal(asset.has_fuel_rate_override,true);assert.equal(Number(asset.fuel_rate_override),12);await a.query('update public.categories set default_fuel_rate=99 where id=$1',[cat.id]);assert.equal(Number((await one(a,'select fuel_rate_override r from public.assets where id=$1',[asset.id])).r),12);});
 await check('legacy false override cannot restore inheritance',async()=>{const u=await rpc(a,'update_asset',asset.id,asset.version,{has_fuel_rate_override:false},{});assert.equal(u.has_fuel_rate_override,true);assert.equal(Number(u.fuel_rate_override),12);});
 const ft=await one(a,"insert into public.fuel_types(name,unit) values('fuel','لتر') returning *");
 const c2=await one(a,"insert into public.categories(name,code_prefix,uses_meter,meter_unit,supports_fuel,default_fuel_rate) values('fuel','WFF',true,'ساعة تشغيل',true,1) returning *");
 await rpc(a,'create_asset',{category_id:c2.id,name:'fuel asset',fuel_type_id:ft.id},{});
 await check('used fuel unit is locked in native PostgreSQL',()=>rejects(()=>a.query("update public.fuel_types set unit='جالون' where id=$1",[ft.id])));
 await check('operator cannot invoke either reset RPC',async()=>{await rejects(()=>rpc(b,'aoms_reset_preview'));await rejects(()=>rpc(b,'reset_aoms_data','مسح شامل','x'));});
 let preview=await rpc(a,'aoms_reset_preview');
 await check('wrong confirmation cannot remove assets',async()=>{await rejects(()=>rpc(a,'reset_aoms_data','wrong',preview.fingerprint));assert.equal((await one(a,'select count(*)::int n from public.assets')).n,2);});
 await check('new writes invalidate reset fingerprint',async()=>{await a.query("insert into public.operators(name) values('after preview')");await rejects(()=>rpc(a,'reset_aoms_data','مسح شامل',preview.fingerprint));assert.equal((await one(a,'select count(*)::int n from public.assets')).n,2);});
 await check('exclusive reset locks block concurrent reads until transaction completes; rollback restores all data',async()=>{
  await a.query('begin');try{preview=await rpc(a,'aoms_reset_preview');await rpc(a,'reset_aoms_data','مسح شامل',preview.fingerprint);await b.query("set lock_timeout='75ms'");await rejects(()=>b.query('select count(*) from public.assets'));}finally{await a.query('rollback');await b.query("set lock_timeout='0'");}
  assert.equal((await one(a,'select count(*)::int n from public.assets')).n,2);
 });
 const backup=await rpc(a,'export_aoms_backup');
 await check('successful reset preserves users, settings and existing audit',async()=>{const before=await one(su,'select (select count(*)::int from public.profiles) profiles,(select count(*)::int from public.app_settings) settings,(select count(*)::int from public.audit_logs) audits');preview=await rpc(a,'aoms_reset_preview');await rpc(a,'reset_aoms_data','مسح شامل',preview.fingerprint);const after=await one(su,'select (select count(*)::int from public.profiles) profiles,(select count(*)::int from public.app_settings) settings,(select count(*)::int from public.audit_logs) audits');assert.equal(after.profiles,before.profiles);assert.equal(after.settings,before.settings);assert.equal(after.audits,before.audits+1);assert.equal((await one(a,'select count(*)::int n from public.assets')).n,0);});
 await check('backup restores the cleared database',async()=>{await rpc(a,'restore_aoms_backup',backup);assert.equal((await one(a,'select count(*)::int n from public.assets')).n,2);});
 console.log(JSON.stringify({nativePostgres:true,passed,productionData:false}));
}finally{await Promise.all(clients.map(c=>c.end()));}
