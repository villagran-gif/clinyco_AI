# Crear DEAL desde Chatwoot

Registrar una Dashboard App llamada `Crear DEAL` en la cuenta 162472, con URL `https://clinyco-ai.netlify.app/chatwoot-deals.html`.

La aplicación recibe el contexto oficial `appContext`, comprueba origen/ventana/cuenta y abre el CRM en una pestaña superior. Solo transmite el ID de conversación. No usa ni recibe credenciales de Google. La página principal exige la sesión autorizada existente; guarda el ID pendiente durante el inicio de sesión.

El servidor resuelve el contacto desde `crm_link_conversations`, nunca desde nombres o IDs de contacto suministrados por el iframe. Si aún no se ha importado la conversación, solicita reintentar tras la sincronización. El formulario permite elegir embudo, etapa, sede y los catálogos existentes. Guardar crea el deal y registra la conversación de origen, cuya pertenencia al contacto se comprueba nuevamente dentro de la transacción. La restricción existente evita duplicar contacto y embudo.

No envía mensajes ni notas a Chatwoot y no crea oportunidades al abrir el enlace. El puente estático no entrega información del CRM. No se agregan campos históricos hasta que el usuario los seleccione.

Protocolo contrastado con [Frame.vue oficial de Chatwoot](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/dashboard/components/widgets/DashboardApp/Frame.vue).
