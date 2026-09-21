import { db, json, nowIso } from './_shared/natcorp-db.mjs';
import { loadCanonicalDistribution, toLegacyCompatibilityRow } from './_shared/cbrief-distribution-source.mjs';

const CHUNK=100;

export default async function handler(){
  try{
    const canonical=await loadCanonicalDistribution();
    const rows=canonical.map(toLegacyCompatibilityRow).filter(Boolean);
    let written=0;
    for(let i=0;i<rows.length;i+=CHUNK){
      const batch=rows.slice(i,i+CHUNK);
      const out=await db('state_contract_opportunities','POST','?on_conflict=id',batch,'resolution=merge-duplicates,return=representation');
      written+=Array.isArray(out)?out.length:0;
    }
    return json(200,{ok:true,source:'public.cbrief_distribution_ready_opportunities',destination:'public.state_contract_opportunities',mode:'compatibility_mirror',fetched:canonical.length,written,synced_at:nowIso()});
  }catch(error){
    console.error('[cbrief-distribution-sync]',error);
    return json(500,{ok:false,error:error?.message||String(error)});
  }
}

export const config={schedule:'@hourly'};
