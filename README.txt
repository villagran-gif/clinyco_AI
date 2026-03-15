Archivos incluidos:
- server.js  (version integrada con conversation-resolver)
- conversation-resolver.js

Pasos:
1. Reemplaza tu server.js actual por el server.js de este paquete.
2. Copia conversation-resolver.js en la misma carpeta del repo.
3. Valida localmente:
   node --check server.js
4. Commit y push.

Qué cambia:
- importa conversation-resolver.js
- guarda caseType / nextAction / faltantes en state.identity
- usa Support + Sell ya guardados en supportRaw/sellRaw
- antes de askOpenAI, decide si falta una pregunta concreta
- mantiene reglas especiales ya existentes (profesional desconocido, Caso E, Fonasa tramo, Isapre genérica)
