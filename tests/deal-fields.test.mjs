import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDealDetails,computedDealDetails,dealFields} from '../review/deal-fields.js';
test('validates only selected editable fields and preserves explicit clearing',()=>{
  assert.deepEqual(validateDealDetails({city:'  Santiago ',value:0,email:''}),{city:'Santiago',value:0,email:null});
  for(const invalid of [{age:12},{height:0},{weight:Infinity},{value:-1},{birthDate:'2025-02-29'},{birthDate:'2099-01-01'},{email:'invalid'},{gallstones:'inventado'},{idDocument:'12.345.678-9'}])assert.throws(()=>validateDealDetails(invalid));
  assert.equal(validateDealDetails({idDocument:'PAS1234'}).idDocument,'PAS1234');
  assert.equal(new Set(dealFields.map(f=>f.key)).size,dealFields.length);
});
test('medical record and exams links require exact approved HTTPS destinations',()=>{
  const good={medinetUrl:'https://clinyco.medinetapp.com/pacientes/ficha/123/1/',examsUrl:'https://drive.google.com/drive/folders/example?usp=sharing'};
  assert.deepEqual(validateDealDetails(good),good);
  for(const url of ['javascript:alert(1)','https://drive.google.com.evil.example/file','https://user:pass@drive.google.com/file','http://drive.google.com/file'])assert.throws(()=>validateDealDetails({examsUrl:url}));
  assert.throws(()=>validateDealDetails({medinetUrl:'https://clinyco.medinetapp.com/other/123'}));
});
test('age uses birthday boundary; BMI, RUT and WhatsApp derive from supplied values',()=>{
  const details={birthDate:'1990-09-12',weight:90,height:180,idDocument:'12.345.678-5',phone:'9 1234 5678'};
  assert.deepEqual(computedDealDetails(details,'2026-09-11'),{age:35,bmi:27.8,normalizedRut:'123456785',whatsappUrl:'https://wa.me/56912345678'});
  assert.equal(computedDealDetails(details,'2026-09-12').age,36);
  assert.equal(computedDealDetails({}).bmi,null);
  assert.equal(computedDealDetails({idDocument:'PAS1234'}).normalizedRut,null);
});
