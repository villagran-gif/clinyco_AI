# Clínyco AI Core

Clínyco AI es el **núcleo de inteligencia conversacional y operacional** de AntonIA.

## Arquitectura activa

```text
Chatwoot Cloud
  -> Clínyco Integration Gateway
  -> POST /chatwoot/inbound
  -> clinyco_AI
       -> AntonIA
       -> memoria y scoring
       -> knowledge
       -> Medinet
       -> EugenIA
  -> Chatwoot API
```

## Responsabilidades

- Motor conversacional de AntonIA.
- Memoria persistente y perfil de paciente/cliente.
- Lead scoring y siguiente mejor acción.
- Integración con Medinet para búsqueda de agenda y reserva.
- EugenIA como capa de observación/aprendizaje del handoff humano.
- Análisis de sentimiento y herramientas de revisión/observabilidad.
- Automatizaciones de contenido y operaciones que no dependan de CRM legacy.

## Canal conversacional

**Chatwoot es el único transporte conversacional activo.**

Entrada:

```text
POST /chatwoot/inbound
Authorization: Bearer <CHATWOOT_ADAPTER_TOKEN>
```

Salida: Chatwoot Application API mediante `chatwoot-adapter/client.js`.

Cuando un agente humano responde en Chatwoot, AntonIA entra en pausa temporal. La duración se controla con `HUMAN_HANDOFF_PAUSE_MINUTES` (default 120 minutos).

## Sistemas retirados

El runtime no debe depender de:

- Zendesk Support.
- Sunshine Conversations.
- Zendesk Sell.
- Frappe/FCRM.

Los nombres de campos legacy que permanezcan en estados históricos o PostgreSQL se consideran compatibilidad de datos, no integraciones activas.

## Desarrollo

```bash
npm install
npm start
```

Node.js >= 18.

## Seguridad

- Secretos sólo en variables de entorno.
- No subir respaldos de CRM, archivos de pacientes ni credenciales al repositorio.
- Los datos históricos sensibles deben almacenarse fuera de Git en infraestructura privada apropiada.
