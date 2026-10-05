export async function callGas(env,action,payload={}){
  if(!env.GAS_WEB_APP_URL||!env.GAS_API_SECRET)throw new Error('Google Apps Script environment is not configured.');
  const body=JSON.stringify({apiSecret:env.GAS_API_SECRET,action,payload});
  let lastErr;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const response=await fetch(env.GAS_WEB_APP_URL,{method:'POST',redirect:'follow',headers:{'content-type':'text/plain;charset=UTF-8'},body});
      const text=await response.text();
      let data;
      try{data=JSON.parse(text)}catch{
        const e=new Error(`Apps Script returned invalid response (${response.status}).`);
        e.status=response.status||502;
        throw e;
      }
      if(!response.ok||data.ok===false){
        const e=new Error(data.error||`Apps Script request failed (${response.status})`);
        e.status=data.status||response.status||400;
        throw e;
      }
      return data;
    }catch(e){
      lastErr=e;
      const retryable=!e.status||e.status===404||e.status===408||e.status===429||e.status>=500;
      if(attempt>=2||!retryable)throw e;
      await new Promise(r=>setTimeout(r,450));
    }
  }
  throw lastErr||new Error('Apps Script request failed.');
}
