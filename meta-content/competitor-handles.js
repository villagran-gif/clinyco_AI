// meta-content/competitor-handles.js
//
// Lista curada de handles IG a auditar con Business Discovery API.
// Salidos del v2 del análisis de competidores (data/benchmarks/
// competidores-chile-2026-06-v2.md) — solo handles VERIFICADOS, sin
// inventados.
//
// El campo `group` determina cómo se agrupa en el dashboard. La razón
// (`why`) viene del v2 y sirve como tooltip educativo.

export const COMPETITOR_HANDLES = [
  // ── Cirujanos chilenos (top de ranking) ──
  { handle: "drcamiloboza",           group: "cirujanos_cl", why: "Autoridad SCCBM/IFSO, contenido pregunta→respuesta" },
  { handle: "camiloboza",             group: "cirujanos_cl", why: "Cuenta personal del Dr. Boza (referencia)" },
  { handle: "dr.marcosberry",         group: "cirujanos_cl", why: "Líder de volumen, ex-mentor de Villagrán" },
  { handle: "rodrigomunozdr",         group: "cirujanos_cl", why: "Funnel directo bio→sitio→WhatsApp" },
  { handle: "dralexescalona",         group: "cirujanos_cl", why: "Programa Obesidad/Diabetes UANDES" },
  { handle: "drfranciscorodriguez1",  group: "cirujanos_cl", why: "Líder digital del NORTE (Antofagasta)" },
  { handle: "drnicolasquezada",       group: "cirujanos_cl", why: "Vicepresidente SCCBM, autoridad académica UC" },
  { handle: "dr.rafaelluengas",       group: "cirujanos_cl", why: "Robótica MARS + Bono PAD FONASA" },
  { handle: "dr.ramondiazjara",       group: "cirujanos_cl", why: "Miembro equipo Clínyco — activo propio" },

  // ── Instituciones / Clínicas ──
  { handle: "cirugiabariatrica_chile", group: "clinicas",   why: "Match de modelo: clínica-equipo, competidor directo" },
  { handle: "bariatric.cl",            group: "clinicas",   why: "Agencia de derivación, canaliza presencia de Berry" },
  { handle: "clinicacumbresdelnorte",  group: "clinicas",   why: "Modelo clínica-equipo idéntico al de Clínyco, en el norte" },
  { handle: "clinicameds",             group: "clinicas",   why: "Donde atiende Boza, ecosistema cruzado" },
  { handle: "sccbmchile",              group: "clinicas",   why: "Sociedad chilena, sirve de co-branding" },

  // ── Equipo de apoyo (nutrición/psicología) ──
  { handle: "nutricionista.mcbenavides",   group: "apoyo", why: "Nutricionista bariátrica #1 en redes (~12K)" },
  { handle: "nutricionista.marianamunoz",  group: "apoyo", why: "Nutrición post-op, recetas/proteína" },
  { handle: "nutribariatrica_cristinajulio", group: "apoyo", why: "Nutrición bariátrica" },
  { handle: "psicologabariatrica_",        group: "apoyo", why: "Psico-bariátrica chilena (vacío de escala detectado)" },

  // ── Referentes LATAM (techo de la categoría) ──
  { handle: "dr.piskulich",            group: "latam",     why: "Bariátrico líder LATAM, playbook ya documentado" },
  { handle: "psicologa.bariatrica",    group: "latam",     why: "Referente brasileño de psico-bariátrica" },
];

export const GROUP_LABELS = {
  cirujanos_cl: "Cirujanos Chile",
  clinicas: "Clínicas / instituciones",
  apoyo: "Equipo de apoyo (nutri / psico)",
  latam: "Referentes LATAM (techo)",
};
