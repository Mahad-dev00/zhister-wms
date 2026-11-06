const { getVerifiedAdmin, originAllowed } = require("../../lib/auth");
const ADMIN_EMAIL = "mahad.warsame.work@gmail.com";

async function requireAdmin(req,res){
  const user=await getVerifiedAdmin(req,res,true);
  if(!user||!user.email_confirmed_at||String(user.email||"").toLowerCase()!==ADMIN_EMAIL){
    res.status(401).json({error:"Sign in with the authorised WMS administrator account."});
    return null;
  }
  return user;
}
function supabaseConfig(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("WMS database integration is not configured in this Preview environment.");
  return {url:url.replace(/\/$/,""),key};
}
async function rpc(name,body){
  const {url,key}=supabaseConfig();
  const response=await fetch(url+"/rest/v1/rpc/"+name,{
    method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify(body||{}),signal:AbortSignal.timeout(15000)
  });
  const raw=await response.text();let data;
  try{data=raw?JSON.parse(raw):null}catch{data=null}
  if(!response.ok)throw new Error("WMS inventory request failed (HTTP "+response.status+").");
  return data;
}
module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","no-store, max-age=0");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="GET"&&req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"})}
  try{
    const user=await requireAdmin(req,res);if(!user)return;
    if(req.method==="GET"){
      const [inventory,movements]=await Promise.all([rpc("list_wms_inventory",{}),rpc("list_wms_stock_movements",{})]);
      return res.status(200).json({inventory:Array.isArray(inventory)?inventory:[],movements:Array.isArray(movements)?movements:[]});
    }
    if(!originAllowed(req))return res.status(403).json({error:"Request origin is not allowed."});
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const articleCode=String(body.articleCode||"").trim(),locationCode=String(body.locationCode||"").trim();
    const delta=Number(body.quantityDelta),type=String(body.movementType||"");
    const reference=String(body.reference||"").slice(0,120),note=String(body.note||"").slice(0,500);
    if(!articleCode||articleCode.length>120||!locationCode||locationCode.length>40||!Number.isFinite(delta)||delta===0||!["receipt","adjustment"].includes(type)){
      return res.status(400).json({error:"Choose an article and location, then enter a non-zero quantity and movement type."});
    }
    const result=await rpc("record_wms_stock_movement",{
      p_article_code:articleCode,p_location_code:locationCode,p_quantity_delta:delta,
      p_movement_type:type,p_reference:reference||null,p_note:note||null,p_actor:user.id
    });
    return res.status(200).json({ok:true,result});
  }catch(error){
    return res.status(502).json({error:error?.message||"Could not complete the inventory request."});
  }
};
