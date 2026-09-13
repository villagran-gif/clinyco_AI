// This client belongs to the Chilean VPS; it must not be imported by Render routes.
import { snapshotDays } from '../review/medinet-snapshot.js';
export function createChileanMedinetClient({env=process.env,http=fetch}={}) {
  let token=null,expires=0,pendingLogin=null;
  const base='https://clinyco.medinetapp.com';
  async function login(){
    if(token&&Date.now()<expires)return token;
    if(!env.MEDINET_USER||!env.MEDINET_USER_KEY)throw new Error('medinet_credentials_missing');
    if(!pendingLogin)pendingLogin=(async()=>{
      const response=await http(base+'/token-login/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:env.MEDINET_USER,password:env.MEDINET_USER_KEY}),signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok){const error=new Error('medinet_login_denied');error.status=response.status;throw error;}
      const body=await response.json();if(!body.token)throw new Error('medinet_token_missing');token=body.token;expires=Date.now()+60*60*1000;return token;
    })().finally(()=>{pendingLogin=null;});
    return pendingLogin;
  }
  return async function appointments(start,end){
    snapshotDays(start,end);
    for(let attempt=0;attempt<2;attempt++){
      const jwt=await login();
      const response=await http(base+`/api-public/schedule/appointment/all-appointments/${start}/${end}/`,{headers:{Authorization:'MEDINET_JWT '+jwt,Accept:'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});
      if(response.status===401&&attempt===0){token=null;expires=0;continue;}
      if(!response.ok){const error=new Error('medinet_appointments_unavailable');error.status=response.status;throw error;}
      return response.json();
    }
  };
}
export const fetchChileanAppointments=createChileanMedinetClient();
