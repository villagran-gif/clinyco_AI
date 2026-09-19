import { bookSlotOnChileVps } from '../melania/medinet-worker-client.js';
import { getPool } from '../db.js';

const conversationId=String(process.env.BOOKING_RECOVERY_CONVERSATION_ID||'').trim();
if(conversationId){
  setTimeout(async()=>{
    try{
      const db=getPool();
      if(!db) throw Error('booking_recovery_db_unavailable');
      const {rows}=await db.query(
        "SELECT state_json FROM conversations WHERE conversation_id=$1 ORDER BY updated_at DESC LIMIT 1",
        [conversationId.startsWith('cw:')?conversationId:`cw:${conversationId}`]
      );
      const state=rows[0]?.state_json||{};
      const slot=state?.booking?.chosenSlot;
      const rut=state?.contactDraft?.c_rut;
      if(!slot?.dataDia||!slot?.time||!slot?.professionalId||!rut) throw Error('booking_recovery_state_incomplete');
      const result=await bookSlotOnChileVps({
        slot,
        patientData:{rut},
        branchId:slot.branchId
      });
      console.log('[booking-recovery]',JSON.stringify({
        conversationId,
        success:!!result?.success,
        step:result?.step||null,
        appointmentId:result?.appointmentId||null,
        message:result?.message||null,
        slot:result?.slot||null,
        patientReply:result?.patient_reply||null
      }));
    }catch(e){
      console.error('[booking-recovery]',JSON.stringify({conversationId,error:e.message}));
    }
  },8000).unref();
}
