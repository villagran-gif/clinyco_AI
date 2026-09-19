import { bookSlotOnChileVps } from '../melania/medinet-worker-client.js';

const raw=String(process.env.BOOKING_RECOVERY_JSON||'').trim();
if(raw){
  setTimeout(async()=>{
    try{
      const job=JSON.parse(raw);
      if(!job?.key||!job?.slot?.dataDia||!job?.slot?.time||!job?.patientData?.rut) throw Error('invalid_booking_recovery');
      const result=await bookSlotOnChileVps({slot:job.slot,patientData:job.patientData,branchId:job.branchId||job.slot.branchId});
      console.log('[booking-recovery]',JSON.stringify({
        key:job.key,
        success:!!result?.success,
        step:result?.step||null,
        appointmentId:result?.appointmentId||null,
        message:result?.message||null,
        slot:result?.slot||null,
        patientReply:result?.patient_reply||null
      }));
    }catch(e){
      console.error('[booking-recovery]',JSON.stringify({error:e.message}));
    }
  },8000).unref();
}
