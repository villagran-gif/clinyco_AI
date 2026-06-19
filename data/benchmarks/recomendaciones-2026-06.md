# Recomendaciones estratégicas — Junio 2026

> Estrategia de publicación construida sobre dos insumos: (1) los benchmarks de la industria (ver tab Benchmarks) y (2) la data en vivo de @clinyco.cl, @doctorvillagran y @fonasapad (ver tab Social IG/FB). Se actualiza mensualmente.

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

### 4. Aplicar formato @drpiskulich a @doctorvillagran

⏳ **Pendiente — análisis profundo de @drpiskulich corriendo, llegará en una actualización**.

Hipótesis preliminar: la cuenta del Doctor publica ~1.9 IG/semana, bajo el optimal de 2-4 healthcare. Subir a 2-3 posts/sem + Stories diarios. Mantener carrusel educativo (ya es su formato top con avg 184 engagement vs video 85).

### 5. Investigar el drop de seguidores de @doctorvillagran

110K → 109K en últimos meses (-0.9%). Posibles causas:

1. Limpieza normal de Instagram (cuentas falsas/inactivas borradas) → benigno
2. Saturación de tema → contenido más diverso necesario
3. Falta de Stories → retention baja
4. CTA débil → algoritmo empuja menos

**Acción**: usar el endpoint `/api/review/social/follower-trend?account=doctorvillagran&days=90` para ver el drop día a día. Si es lineal suave → hygiene. Si es escalonado → algo cambió en una fecha específica que podemos correlacionar con un cambio de contenido.

---

## 📊 Plan operativo semanal

| Cuenta | Posts/sem | Stories/día | Días sweet-spot |
|---|---|---|---|
| @clinyco.cl | 3-4 | 1-2 | Lun, Mié, Vie |
| @doctorvillagran | 3 (subir desde 1.9) | 2-3 | Mar, Vie, Dom |
| @fonasapad | 0-1 | 0 | (cuenta dormida, tracking-only) |

## 🎨 Mix de contenido recomendado (basado en data interna)

### @clinyco.cl
- 50% videos cortos educativos (Reels 15-30 seg) — formato VIDEO ya es el top con avg 36.4
- 30% carruseles educativos (FONASA, procedimientos, equipo)
- 20% testimonios con cara tapada o solo voz

### @doctorvillagran
- 60% carruseles educativos (el formato gana 2x sobre Reels: 184 vs 85)
- 30% Reels de testimonios (formato ganador #3 en cuenta: ♥428, ♥302)
- 10% Stories con CTA de "preguntas al doctor" (rescatar comentarios para próxima publicación)

## 🚫 Qué NO hacer este mes

- Postear bienvenidas de equipo nuevo en @clinyco.cl como contenido principal. Los datos muestran que estos son los posts de peor performance (avg 33 vs top 153).
- Compartir antes/después de cirugía plástica como **ads en feed** — Meta lo prohibió en 2025. Sí se puede en posts orgánicos con consentimiento.
- Postear diario "porque sí" — si no hay contenido educativo, mejor solo Stories ese día.

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
- Próxima actualización planificada: **Julio 2026** (incorpora playbook completo de @drpiskulich + análisis de competidor @cirugiabariatrica_chile)
