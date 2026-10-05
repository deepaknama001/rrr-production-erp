export async function callGas(env,action,payload={}){
  if(!env.GAS_WEB_APP_URL||!env.GAS_API_SECRET)throw new Error('Google Apps Script environment is not configured.');
  const response=await fetch(env.GAS_WEB_APP_URL,{method:'POST',redirect:'follow',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({apiSecret:env.GAS_API_SECRET,action,payload})});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{throw new Error(`Apps Script returned invalid response (${response.status}).`)}
  if(!response.ok||data.ok===false){const e=new Error(data.error||`Apps Script request failed (${response.status})`);e.status=data.status||400;throw e}return data;
}
