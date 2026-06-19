# Recomendaciones estratégicas — Junio 2026

> Estrategia de publicación construida sobre dos insumos: (1) los benchmarks de la industria (ver tab Benchmarks) y (2) la data en vivo de @clinyco.cl, @doctorvillagran y @fonasapad (ver tab Social IG/FB). Se actualiza mensualmente.

> **Decisión estratégica de junio (confirmada por dirección)**: fortalecer **@fonasapad** y **@clinyco.cl** como caras principales de marca, diversificar el peso de marca hacia el equipo Clínyco. La cuenta @doctorvillagran sigue activa pero deja de ser el único motor de marca. Este giro se refleja en todas las prioridades de abajo.

---

## 🎯 Prioridades del mes

### 1. Cambiar el CTA de "dame like" a "guarda" y "comparte"

**🧒 Básico**: Antes pedíamos "déjanos tu corazón si te gustó". Eso ya no funciona — Instagram en 2026 le da más peso a guardados (saves) y compartidos (shares) que a likes. Cambiar el cierre de cada caption: "¿Conoces a alguien que necesite esta info? Compártela." o "Guarda este post para volver a leerlo después".

**👨‍⚕️ Técnico**: Adam Mosseri y la documentación del IG ranking 2025-2026 confirman que `shares` y `saves` son los dos ranking signals más fuertes para la decisión de "mostrar a no-seguidores" (Reels y Explorar). Likes pasaron a ser una señal de tercer nivel. CTA debe mover ESA acción específica.

### 2. Mover @clinyco.cl al sweet-spot de healthcare

**Hoy publica**: principalmente miércoles y jueves.
**Benchmark healthcare 2025-2026**: Lunes 12-21h, Miércoles 11-17h, Martes y Viernes 8-10h.
**Acción**: agendar 2 posts/semana en Lun + Mié; mantener jueves como secundario. Datos en el tab Social IG/FB confirman que miércoles (n=11) es el día con peor engagement promedio (20.6) vs viernes (n=4, 57.5).

### 3. Empezar a publicar Stories diariamente (las 3 cuentas)

**🧒 Básico**: Stories son los videos cortos de 24 h. Te ayudan a aparecer arriba del feed de quienes te siguen. Si no posteas Stories, Instagram empieza a mostrarte menos. Tu data: las 3 cuentas tienen pocas o ninguna Story activa cuando revisamos.

**👨‍⚕️ Técnico**: Stories impulsan retention y signal "active creator" al algoritmo. Stories archive no es queryable vía API pública — para tendencias hay que registrarlas diariamente con un cron. Por ahora medimos sólo el snapshot live (visible en el tab Social IG/FB cuando haya).

### 4. Aplicar las 5 tácticas del playbook Piskulich a @doctorvillagran

**Corrección importante**: el cirujano es **Erick Piskulich**, no Antonio; su handle de IG es **@dr.piskulich** (NO @drpiskulich, ese es TikTok). El "+800%" reportado por Cosas.pe en 2020 es **claim de marketing auto-reportado, no auditado**, y corresponde a 2017→2020 (3 años, no 1). Lo tratamos como inspiración táctica, no como KPI.

**Las 5 tácticas trasladables (ver `playbook-drpiskulich` para el detalle)**:

1. **Narrativa personal del cirujano > contenido educativo genérico.** Piskulich vende su biografía (tuvo obesidad mórbida, llegó a 128 kg, sufrió bullying). Articular la historia de origen del Dr. Villagrán es más rentable que más infografías genéricas. Acción: 1 carrusel "mi historia" pinned + 4 Reels al año con ángulos distintos de esa historia.

2. **Hook = mythbusting + alerta a desinformación.** Fórmula del Piskulich top-performing: `🚨 ALERTA + mito popular + por qué es falso + CTA share`. Alto save+share rate, sin riesgo regulatorio (no es promesa estética). Acción: 1 post/semana de Villagrán con este formato.

3. **Funnel sin Linktree.** Piskulich va directo: bio IG → sitio propio → botón WhatsApp visible. Solo 2 clicks. Linktree suma 1 click extra + lo ven como spam. Acción: revisar bio de Villagrán y eliminar intermediarios.

4. **YouTube long-form "Historias que Sanan".** Piskulich produce entrevistas-podcast con pacientes que **consienten cara y nombre** en formato 12-25 min. Esto soluciona el dilema de privacidad: el paciente quiere contar su historia (no exponer su cuerpo). Después se extrae 5-10 clips/episodio para Reels. Acción: 1 episodio/mes piloto.

5. **Cross-platform vía TV/podcasts mainstream.** Piskulich apareció en TV (No Somos TV) y podcast Todo Good. Cada aparición se convierte en semanas de contenido derivado. Acción: identificar 2-3 podcasts chilenos de salud-conversación o farándula para Villagrán este trimestre.

Su cadencia actual en IG: ~1.9 posts/semana, bajo el optimal de 2-4 healthcare. Subir a 2-3 posts/sem (priorizando carruseles, ya gana 2.2x sobre Reels en su cuenta) + Stories diarios + 1 long-form/mes en YouTube.

### 5. Investigar el drop de seguidores de @doctorvillagran

110K → 109K en últimos meses (-0.9%). Posibles causas:

1. Limpieza normal de Instagram (cuentas falsas/inactivas borradas) → benigno
2. Saturación de tema → contenido más diverso necesario
3. Falta de Stories → retention baja
4. CTA débil → algoritmo empuja menos

**Acción**: usar el endpoint `/api/review/social/follower-trend?account=doctorvillagran&days=90` para ver el drop día a día. Si es lineal suave → hygiene. Si es escalonado → algo cambió en una fecha específica que podemos correlacionar con un cambio de contenido.

---

## 📊 Plan operativo semanal (revisado tras decisión estratégica)

| Cuenta | Posts/sem | Stories/día | Días sweet-spot | Rol en la marca |
|---|---|---|---|---|
| @clinyco.cl | 4-5 (subir desde 3.5) | 2-3 | Lun, Mié, Vie | **Cara principal de marca** — equipo multidisciplinario con rostros |
| @fonasapad | 7 (uno por día) | 1-2 | Diario | **Re-publicación curada** de los mejores posts de @clinyco.cl + @doctorvillagran, con aprobación 1-clic por WhatsApp (Allison + Rodrigo) |
| @doctorvillagran | 2-3 | 1-2 | Mar, Vie, Dom | **Activo del equipo, no único motor** — sigue produciendo carrusel educativo, pero parte del foco se redistribuye a @clinyco.cl |

### Flujo de @fonasapad (1-clic + WhatsApp)

1. Cada noche, el sistema selecciona el siguiente post elegible (mejores primero) del catálogo histórico de @clinyco.cl + @doctorvillagran que NO se haya re-publicado todavía.
2. Genera preview (imagen + caption adaptado a la voz Fonasa+Bono PAD) y lo deja en una cola en el dashboard.
3. Envía un WhatsApp a **Allison (+56 9 3426 6846)** y a **Rodrigo (+56 9 8729 7033)** con la preview + 2 botones: **Aprobar** / **Rechazar**.
4. Cualquiera de los dos aprueba → publica en @fonasapad (Facebook al instante; Instagram crea el "container" y publica en el momento, porque IG no soporta borradores que duren).
5. Si ninguno responde antes de la hora de publicación (sweet-spot del día), envía un recordatorio. Si tampoco entonces, salta ese día y registra el motivo.

Una vez agotado el material histórico, @fonasapad pasa a publicar **en cadencia conjunta** de ambas cuentas en vivo, con el mismo flujo de aprobación.

## 🎨 Mix de contenido recomendado (basado en data interna + decisión estratégica)

### @clinyco.cl (cara principal de marca)
- 30% **serie permanente "Equipo Clínyco al frente"** — Reel quincenal por cirujano del equipo: Dr. Alberto Sirabo, Dr. Andrés San Martín, Dr. Ramón Díaz (los tres confirmados en el equipo según `clinyco.cl/medicos` pero hoy invisibles en `@clinyco.cl`). Añadir nutricionista + psicólogo/a (Bencina/Pizarro del equipo). Modelo "equipo con cara" que ningún competidor chileno tiene, incluyendo Cumbres del Norte.
- 20% **serie "Cómo opero con Bono PAD FONASA"** — ángulo de altísima intención comercial sub-explotado por Berry/Boza/Muñoz, fuerte solo en Cumbres del Norte y Zamarin. Combinar Reels cortos (qué cubre, requisitos, copago aproximado) + piezas largas en YouTube/TikTok.
- 20% Reels cortos educativos (15-30 seg) — formato VIDEO ya es el top con avg 36.4
- 20% testimonios con cara tapada o solo voz, narrados por miembros del equipo
- 10% contenido de seguridad y protocolo (criterios de selección, anestesia, manejo de complicaciones) — refuerza confianza institucional

### @fonasapad (re-publicación curada)
- 100% backfill ordenado de los mejores posts históricos de @clinyco.cl + @doctorvillagran (mejores primero), adaptando caption a la voz Fonasa+Bono PAD donde tenga sentido
- Stories: 1-2 diarias re-compartiendo el post del día y la última story de las otras cuentas

### @doctorvillagran (activo del equipo, no único motor)
- 60% carruseles educativos (el formato gana 2x sobre Reels: 184 vs 85)
- 25% Reels de testimonios (formato ganador #3: ♥428, ♥302)
- 15% Stories con caja de preguntas, alimentadas por comentarios de la semana

## 🛠️ Implementación de @fonasapad — qué falta (bloqueante)

WhatsApp **no permite mensajes proactivos** fuera de las 24h sin una **plantilla aprobada por Meta**. Las plantillas activas hoy (`llamada_perdida_followup_v2`, `contactarprimera`) son de servicio al paciente, no sirven para esto.

**Acción**: crear y enviar a aprobación una plantilla nueva en WhatsApp Business Manager. Propuesta:

- **Nombre interno**: `fonasapad_aprobar_post`
- **Categoría**: `UTILITY`
- **Idioma**: `es`
- **Body**: `Hola {{1}}, hay un post listo para revisar en @fonasapad. Cuenta origen: {{2}}. Fecha post original: {{3}}. Engagement original: {{4}}.`
- **Buttons** (URL): `✅ Aprobar` ({{1}} = token-aprobar) y `❌ Rechazar` ({{2}} = token-rechazar). Los URLs apuntan a `https://clinyco-ai.netlify.app/api/queue/...` con tokens de un solo uso firmados con HMAC.

Aprobación de Meta tarda 1-24h. Mientras tanto, el flujo funciona **sin WhatsApp**: el dashboard tiene un tab "Cola fonasapad" donde Allison o Rodrigo pueden aprobar/rechazar con un clic, y queda registrado quién aprobó cada uno.

## 🚫 Qué NO hacer este mes

- Postear bienvenidas de equipo nuevo en @clinyco.cl como contenido principal. Los datos muestran que estos son los posts de peor performance (avg 33 vs top 153).
- Compartir antes/después de cirugía plástica como **ads en feed** — Meta lo prohibió en 2025. Sí se puede en posts orgánicos con consentimiento.
- Postear diario "porque sí" — si no hay contenido educativo, mejor solo Stories ese día.

## 🆕 Insights del v2 de competidores (junio 2026)

La investigación v2 ratificó la estrategia y agregó datos críticos. Resumen:

- **El "frente norte" es más fuerte de lo estimado**: el Dr. Francisco Rodríguez de Antofagasta tiene **~68K seguidores** (no microinfluencer como sugería el cliente — handle real `@drfranciscorodriguez1`), y **`@clinicacumbresdelnorte` ~11K** es competidor institucional directo de Clínyco en el norte con modelo idéntico de "clínica-equipo". El liderazgo digital del norte hoy NO es Clínyco; hay que ganarlo o diferenciarse explícitamente (red multi-ciudad vs clínica única).
- **3 caras del equipo Clínyco esperando producción**: Sirabo, San Martín y Ramón Díaz son cirujanos bariátricos del equipo confirmados en clinyco.cl, pero invisibles en `@clinyco.cl`. Convertir cada uno en un Reel quincenal recurrente lleva a Clínyco al modelo "equipo con cara" que ningún competidor chileno tiene.
- **El vacío de psicología bariátrica chilena es de escala, no de personas**: existen Cecilia Navarro (NPCO/SCCBM) y Kimmey Huenchumán con credenciales, pero ninguna con >2K seguidores. Clínyco puede ser el primero en construir la cuenta líder, con psicóloga/psiquiatra propia (Bencina/Pizarro) o asociándose con una figura NPCO autorizada.
- **Pacientes-celebridad como canal**: Christell Rodríguez (700K, operada por Funke en MEDS) no es un caso aislado. Política explícita de pacientes-embajadores con audiencia >10K + consentimiento explícito multiplica visibilidad sin pagar alcance.
- **Sub-cuentas regionales que justifican monitoreo**: Anacona Talca (~9.4K), COBEC Concepción (~8.1K), Andes Salud El Loa Calama (~6.4K) — útiles para entender tácticas territoriales fuera del eje Santiago.

Ver el reporte completo en el tab **Competidores** → selector "Competidores · @chile · v2-2026-06".

## ✅ Métricas a seguir cada lunes

(El próximo PR: tab "Resumen Semanal" que las trae automáticas)

1. Engagement Rate vs benchmark healthcare (objetivo: >1.5%)
2. Save rate por post (objetivo: >2% en carruseles)
3. Share rate por post (objetivo: >1%)
4. Δ seguidores semana (objetivo: +0.5% en @clinyco.cl, estabilizar @doctorvillagran)
5. Stories publicadas vs target (3 cuentas)

---

## Fuentes y próxima actualización

- Datos de benchmarks: ver tab Benchmarks (`/api/social/benchmarks`)
- Datos de cuentas propias: tab Social IG/FB (`/api/social/contact-sheet`)
- **Playbook completo @dr.piskulich**: tab Playbook (`/api/social/playbook`) — 2.100 palabras, 20 fuentes
- Próxima actualización planificada: **Julio 2026** (incorpora análisis de competidor @cirugiabariatrica_chile + revisión de KPIs vs metas)
