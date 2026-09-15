import test from 'node:test';
import assert from 'node:assert/strict';
import {appointmentStatusIntent,extractAppointmentDate,extractAppointmentTime,recoverAppointmentCriteria,matchExistingAppointments,appointmentStatusReply} from '../conversation/appointment-check.js';

const now=new Date('2026-09-15T14:00:00Z');
const row=(status='Agendado',time='09:20')=>({id:500,fecha:'2026/09/24',hora:time,estado:{nombre:status},tipo:'Atención Nutriología',profesional:{nombres:'Ingrid',paterno:'Yevenes Marquez'},sucursal:{nombre:'Antofagasta Mall Arauco Express'},paciente:{run:'10.923.445-1',nombres:'Rafael'}});

test('detects existing appointment verification but not a fresh booking request',()=>{
 assert.equal(appointmentStatusIntent('Tengo una hora con la Dra Yevenes'),true);
 assert.equal(appointmentStatusIntent('me llegó un correo que la habría anulado'),true);
 assert.equal(appointmentStatusIntent('Necesito hora con la Dra Ingrid Yevenes'),false);
});

test('recovers Chilean date and time from fragmented conversation',()=>{
 assert.equal(extractAppointmentDate('para el día 24 de septiembre',now),'2026-09-24');
 assert.equal(extractAppointmentDate('24/09',now),'2026-09-24');
 assert.equal(extractAppointmentTime('a las 9:20'),'09:20');
 const c=recoverAppointmentCriteria({texts:['Hola tengo hora el 24 de septiembre a las 9:20','Con la Dra Yevenes'],rut:'10.923.445-1',professional:'Ingrid Yevenes',now});
 assert.deepEqual(c,{rut:'109234451',professional:'Ingrid Yevenes',date:'2026-09-24',time:'09:20'});
});

test('matches RUT + professional + date + time and reports real Medinet status',()=>{
 const criteria={rut:'109234451',professional:'Ingrid Yevenes',date:'2026-09-24',time:'09:20'};
 const match=matchExistingAppointments([row()],criteria);
 assert.equal(match.exact.length,1);
 assert.match(appointmentStatusReply(match,criteria),/Estado: Agendado/);
 const cancelled=matchExistingAppointments([row('Cancelada')],criteria);
 assert.match(appointmentStatusReply(cancelled,criteria),/figura Cancelada/);
});

test('does not claim requested time when Medinet has another time',()=>{
 const criteria={rut:'109234451',professional:'Ingrid Yevenes',date:'2026-09-24',time:'09:20'};
 const match=matchExistingAppointments([row('Confirmado','10:00')],criteria);
 assert.equal(match.exact.length,0);
 assert.match(appointmentStatusReply(match,criteria),/10:00, no a las 09:20/);
});

test('cancelled requested time reports another active same-day appointment',()=>{
 const criteria={rut:'109234451',professional:'Ingrid Yevenes',date:'2026-09-24',time:'09:20'};
 const match=matchExistingAppointments([row('Cancelada','09:20'),{...row('Agendado','09:40'),id:501}],criteria);
 const reply=appointmentStatusReply(match,criteria);
 assert.match(reply,/09:20 figura Cancelada/);assert.match(reply,/otra cita.*09:40/);assert.match(reply,/Estado: Agendado/);
});
