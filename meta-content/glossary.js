// Bilingual glossary for social-media metrics.
//
// Each entry carries:
//   name        — display name in the dashboard (Spanish first, English term
//                 in parentheses so the team learns the industry word too)
//   basic       — one-breath explanation anyone can grasp
//   detailed    — the SAME plain language but going deeper: expands every
//                 English acronym into Spanish, explains the formula in words
//                 before showing it, and spells out the practical implication.
//                 This is NOT a jargon dump — a non-technical reader should
//                 understand every sentence.
//   sources     — short list of where the benchmark numbers come from
//
// The contact-sheet renderer pulls from here when foregrounding the active
// sort metric so the explanation panel teaches the team as they use the tool.
//
// New metrics added later should keep the same shape so the UI stays uniform.

export const GLOSSARY = {
  engagement: {
    name: "Interacción total / Engagement (♥+💬+↗)",
    basic:
      "De cada 100 personas que ven tu publicación, ¿cuántas hicieron algo con ella? 'Algo' es: dar corazón, comentar, o compartir. Es el número que más se usa para decir si un post 'funcionó'.",
    detailed:
      "La palabra inglesa 'engagement' se traduce como 'interacción' o 'compromiso'. Es la suma de todas las veces que alguien hizo algo público con tu publicación: le dio corazón (like), escribió un comentario, o la compartió (compartir solo se cuenta en Facebook). Se calcula sumando esos números. Ejemplo: un post con 50 corazones, 8 comentarios y 3 compartidos tiene una interacción de 61. " +
      "Cuidado con una trampa: este número es 'absoluto', no está ajustado por cuántos seguidores tienes. Una cuenta de 100.000 seguidores junta más corazones que una de 5.000 aunque la pequeña sea más efectiva. Por eso, para comparar cuentas de distinto tamaño se usa la Tasa de Interacción (en inglés Engagement Rate, que se abrevia ER): se toma la interacción, se divide por el número de seguidores y se multiplica por 100 para dejarlo en porcentaje. En salud, una buena Tasa de Interacción ronda 1,2% a 1,8%, contra un promedio general de internet de apenas 0,4%. " +
      "Lo que este número NO incluye: el alcance (cuánta gente lo vio), las impresiones (cuántas veces se mostró) ni los guardados. Esos los entrega Meta por un canal aparte que activaremos más adelante.",
    sources: ["Meta Graph API (campos básicos)", "Hootsuite Benchmarks 2025", "RivalIQ 2025"],
  },
  likes: {
    name: "Me gusta / Likes (♥)",
    basic:
      "Cuántas personas tocaron el corazón ❤️ de la publicación. Es la reacción más fácil de dar y, hoy, la que menos ayuda a que el post llegue a gente nueva.",
    detailed:
      "'Like' en inglés es 'me gusta' — el corazón ❤️ que la gente toca. En Instagram lo contamos directo del post. En Facebook el número junta TODAS las reacciones: me gusta, me encanta, me divierte, me asombra, me entristece y me enoja (Facebook las suma todas en un solo total). " +
      "Es la reacción que menos esfuerzo cuesta (un toque), y por eso la que MENOS le importa al algoritmo de Instagram en 2026. El 'algoritmo' es el programa automático de Instagram que decide a cuánta gente le muestra cada publicación; hoy le da más peso a que la gente comparta o guarde, que a que solo dé corazón. " +
      "En la práctica: los likes sirven para tomarle el pulso a un post (¿gustó o no?), pero NO son lo que hace que el post se expanda a personas que todavía no te siguen. Si la meta es crecer, conviene perseguir compartidos y guardados, no likes.",
    sources: ["Meta Graph API", "Adam Mosseri (jefe de Instagram), 2025"],
  },
  comments: {
    name: "Comentarios (💬)",
    basic:
      "Cuántas personas escribieron una respuesta. Vale más que un corazón, porque comentar toma esfuerzo: alguien se detuvo a escribir.",
    detailed:
      "Cuántas personas escribieron un comentario en el post. Pesa más que un corazón porque comentar cuesta esfuerzo: la persona se detuvo a redactar algo. " +
      "Un dato clave de cómo funciona Instagram: el algoritmo observa con especial atención los comentarios que llegan en los primeros 30 a 60 minutos después de publicar. En inglés a ese rato se le llama 'golden hour' ('hora dorada'). Si un post junta varios comentarios rápido, Instagram entiende que es interesante y lo empieza a mostrar a más gente. " +
      "Cómo aprovecharlo: publicar cuando tu audiencia está despierta y activa, y terminar el texto con una pregunta concreta que invite a responder ('¿te pasó algo parecido?', '¿qué duda tienes de esto?'). Cada respuesta que tú das a un comentario también cuenta como interacción y empuja el post.",
    sources: ["Meta Graph API", "Sprout Social 2025"],
  },
  shares: {
    name: "Compartidos / Shares (↗)",
    basic:
      "Cuántas personas le mandaron tu publicación a alguien más (por mensaje, en sus historias, a otra app). En 2026 es LO que más hace que un post crezca.",
    detailed:
      "Cuántas personas compartieron tu publicación: se la enviaron a alguien por mensaje privado, la pusieron en sus propias historias, o la sacaron hacia otra aplicación. En inglés se le dice 'share'. " +
      "Es la acción que MÁS le importa al algoritmo en 2026, porque compartir significa que tu contenido fue tan útil o tan impactante que alguien lo quiso pasar a otra persona — el mejor voto de confianza que existe. Por eso la estrategia del mes es cambiar el cierre de cada publicación de 'dale like' a 'compártelo con quien lo necesite'. " +
      "Una limitación importante que hay que tener clara: Facebook SÍ nos entrega este número, pero Instagram NO lo muestra por la vía automática que usa este panel (la 'API', que es el canal por el que un programa le pide datos a Meta). En Instagram los compartidos solo se ven entrando a mano a las estadísticas de cada post. Por eso aquí verás compartidos reales en Facebook, pero 0 en Instagram aunque existan.",
    sources: ["Meta Graph API", "Adam Mosseri, Reel sobre el algoritmo 2025"],
  },
  saves: {
    name: "Guardados / Saves (🔖)",
    basic:
      "Cuántas personas tocaron la banderita 🔖 para volver a ver el post después. Es señal de que tu contenido es útil — como guardar una receta.",
    detailed:
      "Cuántas personas tocaron el ícono de guardar (la banderita 🔖) para volver a ver el post más tarde. En inglés se le dice 'save'. Es señal de utilidad pura: alguien quiere tenerlo a mano para consultarlo después, igual que cuando uno guarda una receta. El algoritmo lo valora casi tanto como los compartidos. " +
      "Por ahora este número NO aparece en este panel, por una razón técnica: Instagram solo lo entrega si se lo pedimos post por post a un canal aparte de Meta, lo que multiplica la cantidad de consultas. Lo activaremos cuando ese costo valga la pena. " +
      "Mientras tanto, una meta sana para contenido educativo (los carruseles que explican algo paso a paso) es que más de 2 de cada 100 personas que lo ven lo guarden. Los carruseles de 'qué esperar antes/después de la cirugía' o 'dudas frecuentes' son los que más se guardan.",
    sources: ["Meta /insights (estadísticas por post)", "Dash Social 2025"],
  },
  reach: {
    name: "Alcance único / Reach",
    basic:
      "Cuántas PERSONAS DISTINTAS vieron tu post. Si la misma persona lo ve 3 veces, eso cuenta como 1 sola en alcance (pero como 3 'impresiones').",
    detailed:
      "Alcance (en inglés 'reach') es cuántas personas distintas vieron tu publicación. Es diferente de las 'impresiones', que cuentan cuántas VECES se mostró: si una persona ve tu post 3 veces, eso son 3 impresiones pero 1 solo de alcance. El alcance te dice el tamaño real de tu público; las impresiones, la insistencia. " +
      "Para saber si tu alcance es bueno se compara contra tus seguidores: es la Tasa de Alcance (en inglés Reach Rate), que es el alcance dividido por el número de seguidores, en porcentaje. Como referencia en cuentas de salud: bajo el 20% es pobre, entre 20% y 40% es normal, sobre 50% es muy bueno (Hootsuite 2025). " +
      "Este dato todavía no aparece en el panel porque, igual que los guardados, Meta lo entrega pidiéndolo post por post. Lo sumaremos en la próxima fase.",
    sources: ["Meta /insights (estadísticas por post)", "Hootsuite 2025"],
  },
  recent: {
    name: "Más recientes primero",
    basic: "Ordena las publicaciones por fecha, la más nueva arriba.",
    detailed:
      "Las publicaciones se ordenan por fecha, de la más nueva a la más antigua. Útil para ver rápido qué subiste último, sin importar cómo le fue en interacción.",
    sources: [],
  },
  oldest: {
    name: "Más antiguos primero",
    basic: "Ordena las publicaciones por fecha, la más vieja arriba.",
    detailed:
      "Las publicaciones se ordenan por fecha, de la más antigua a la más nueva. Útil para revisar cómo partió la cuenta y recorrer su evolución en el tiempo — por ejemplo, para el plan de ir liberando el material antiguo de a poco.",
    sources: [],
  },
  follower_count: {
    name: "Seguidores totales / Followers",
    basic:
      "Cuántas personas siguen la cuenta hoy. Una baja chica (menos del 1% al mes) suele ser limpieza normal de Instagram. Bajas más grandes hay que investigarlas.",
    detailed:
      "Es el número de seguidores que tiene la cuenta cada día. Meta nos entrega una 'foto' diaria de ese número hasta 90 días hacia atrás, así podemos ver la tendencia. " +
      "Lo importante no es el número de un día suelto, sino la FORMA de la curva. Si baja de a poco y pareja, casi siempre es 'limpieza' normal: Instagram borra cada cierto tiempo cuentas falsas, de spam o inactivas, y eso te resta seguidores aunque no hayas hecho nada malo (suele ser menos del 1% al mes). En cambio, si ves una caída en escalón —un día bajas de golpe— eso normalmente coincide con algo puntual: un cambio en el tipo de contenido, una publicación que no gustó, o un ajuste del algoritmo de Instagram. " +
      "Para el caso de @doctorvillagran (que bajó de ~110 mil a ~109 mil), comparamos la curva de seguidores con la interacción por post en las mismas fechas: si ambas bajan juntas, el problema es el contenido; si solo bajan los seguidores pero la interacción se mantiene, es probable que sea limpieza de cuentas inactivas.",
    sources: ["Meta /insights (estadísticas de cuenta)"],
  },
};

export function explain(metricKey) {
  return GLOSSARY[metricKey] ?? null;
}
