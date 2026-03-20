#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function toTsv(rows) {
  const headers = [
    "Activo",
    "Pregunta frecuente",
    "Respuesta aprobada",
    "Cuando derivar a persona",
    "No prometer",
    "Notas para el bot"
  ];
  const lines = [headers.join("\t")];
  for (const row of rows) {
    const values = headers.map((key) =>
      String(row[key] || "")
        .replace(/\t/g, " ")
        .replace(/\r?\n/g, " ")
        .trim()
    );
    lines.push(values.join("\t"));
  }
  return lines.join("\n") + "\n";
}

function buildRows() {
  const commonEscalation =
    "Derivar a humano si piden confirmacion de cupo exacto, evaluacion clinica individual o excepciones no estandar.";
  const commonNoPromise =
    "No prometer cobertura final, aprobacion PAD, cupos ni valores futuros sin validacion oficial.";

  return [
    {
      Activo: "SI",
      "Pregunta frecuente": "cuales son los requisitos para calificar a cirugia bariatrica por fonasa pad",
      "Respuesta aprobada":
        "Para PAD bariatrico (codigo 2501058) FONASA indica beneficiarios entre 18 y 65 anos con criterios de IMC y comorbilidades. Ejemplo: IMC sobre 40, o entre 35 y 40 con morbilidad asociada, o entre 30 y 35 con DM2 de dificil manejo. Se requiere evaluacion medica/nutricional y psicologica, y en casos de salud mental certificado de psiquiatria.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial: nuevo.fonasa.gob.cl cobertura PAD cirugia bariatrica by pass (arancel 2026, revisado 2026-03-20)."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "cual es el valor del pad bariatrico bypass",
      "Respuesta aprobada":
        "En la ficha de FONASA (arancel 2026), bypass bariatrico codigo 2501058 figura con total $4.993.380 y copago $2.496.690. El prestamo medico FONASA puede cubrir 85% del copago ($2.122.190), dejando pie inicial referencial de 15%.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial FONASA PAD 2501058. Antes de cerrar monto, confirmar vigencia anual."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "el balon gastrico tiene cobertura pad fonasa",
      "Respuesta aprobada":
        "No. En los flujos comerciales de Clinyco y en PAD publico, el beneficio PAD aplica a cirugia bariatrica (manga/by pass) y no al balon gastrico. Si quieres, te orientamos con alternativas y evaluacion inicial.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente operacional: respuestas historicas de agentes + sitio fonasapad/clinyco."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "como accedo al bono pad para cirugia bariatrica",
      "Respuesta aprobada":
        "Primero debes contar con evaluacion clinica y documentos requeridos. Luego el prestador en convenio te entrega orden/programa para valorizar y pagar el bono en FONASA. El bono emitido se entrega al prestador antes de la intervencion.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial FONASA PAD: requisitos previos y proceso de emision bono."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "cuales son los requisitos para abdomen flacido pad",
      "Respuesta aprobada":
        "Para PAD tratamiento quirurgico de abdomen flacido (codigo 2505950), FONASA describe criterios como IMC menor a 30 en menores de 55 anos, IMC menor a 25 entre 55 y 65 anos, y pliegue abdominal que cuelgue 5 cm bajo el pliegue inguinal, ademas de criterios de exclusion clinica.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial: nuevo.fonasa.gob.cl abdomen flacido tratamiento quirurgico (arancel 2026)."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "cual es el valor del pad abdomen flacido",
      "Respuesta aprobada":
        "En FONASA PAD (arancel 2026), abdomen flacido codigo 2505950 figura con total $3.583.580 y copago $1.791.790. El prestamo 85% publicado es $1.523.020.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial FONASA PAD 2505950. Confirmar vigencia al momento de cotizar."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "cual es el valor del pad colelitiasis calculos biliares",
      "Respuesta aprobada":
        "En FONASA PAD (arancel 2026), colelitiasis codigo 2501001 figura con total $1.876.680 y copago $938.340. Prestamo 85% publicado: $797.590.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial: nuevo.fonasa.gob.cl colelitiasis calculos biliares."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "quienes pueden acceder a ges colecistectomia preventiva",
      "Respuesta aprobada":
        "Segun Superintendencia de Salud, este problema GES aplica a personas de 35 a 49 anos con calculos en vesicula y vias biliares, desde la sospecha medica y segun NTMA vigente.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial: superdesalud.gob.cl orientacion colecistectomia preventiva (problema 26)."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "cuanto demora el ges de colecistectomia preventiva",
      "Respuesta aprobada":
        "SuperSalud publica plazos maximos de referencia para este GES: diagnostico hasta 30 dias desde sospecha y tratamiento quirurgico hasta 90 dias desde confirmacion diagnostica.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial SuperSalud (plazos problema 26)."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "cuanto pago en ges colecistectomia preventiva",
      "Respuesta aprobada":
        "En la lamina informativa de SuperSalud para este GES: FONASA A-B-C-D informa 0% de copago e ISAPRE 20% para prestaciones GES, segun red y normativa vigente.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial SuperSalud problema 26. Confirmar red y condiciones del caso."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "que servicios ofrece clinyco",
      "Respuesta aprobada":
        "Clinyco publica servicios de cirugia bariatrica, endoscopia/colonoscopia, cirugia digestiva, gastroenterologia, cirugia plastica y telemedicina.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente publica: www.clinyco.cl (home servicios, revisado 2026-03-20)."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "en que ciudades atiende clinyco",
      "Respuesta aprobada":
        "Clinyco publica atencion en Antofagasta, Calama y Santiago. Si quieres, te ayudo a elegir sede y profesional para agendar.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente publica clinyco.cl seccion sedes."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "como agendo hora en clinyco",
      "Respuesta aprobada":
        "Puedes agendar en la agenda web de Clinyco y tambien por WhatsApp de atencion. Para ayudarte mas rapido, dime especialidad/profesional y sede preferida.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente clinyco.cl + patron de agentes humanos en Zendesk."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "que datos necesitan para agendar",
      "Respuesta aprobada":
        "Normalmente se solicita al menos nombre, rut, telefono y especialidad/profesional o examen. Si ya eres paciente, basta con rut y datos de la cita que quieres agendar o reagendar.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Aprendido de flujos de agentes humanos en Zendesk (marzo 2026)."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "hacen bioimpedanciometria",
      "Respuesta aprobada":
        "Si, en conversaciones operativas de Clinyco aparece disponibilidad de bioimpedanciometria. Para confirmar cupo real y preparacion exacta del examen, te ayudo a derivar con agenda.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente operacional: historico Zendesk agentes (confirmar cupo en tiempo real)."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "hacen examenes de imagenologia como ecografia o radiografia",
      "Respuesta aprobada":
        "En conversaciones operativas recientes, agentes indican que Clinyco no realiza imagenologia general en ese flujo. Se debe confirmar caso a caso segun examen especifico.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente operacional Zendesk; mantener respuesta conservadora y derivar para confirmacion."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "atienden ginecologia",
      "Respuesta aprobada":
        "No contamos con servicio de ginecologia en el flujo actual. Si quieres, te orientamos con otras especialidades disponibles en Clinyco.",
      "Cuando derivar a persona":
        "No requiere derivacion, salvo que la persona pida excepcion o coordinacion externa.",
      "No prometer":
        "No prometer disponibilidad de ginecologia.",
      "Notas para el bot":
        "Fuente: fila activa existente en FAQ operacional."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "el pad cubre cirugias revisionales bariatricas",
      "Respuesta aprobada":
        "Segun la ficha oficial FONASA PAD de bypass bariatrico, las cirugias revisionales no proceden por mecanismo PAD cuando existen cirugias bariatricas previas.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial FONASA PAD 2501058."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "el pad se puede pagar en cuotas",
      "Respuesta aprobada":
        "Se puede solicitar prestamo medico FONASA para financiar gran parte del copago (usualmente 85%), quedando un pie inicial. Las condiciones exactas dependen de evaluacion y normativa vigente.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente FONASA PAD + material fonasapad.cl como referencia secundaria."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "quiero saber si califico a pad bariatrico",
      "Respuesta aprobada":
        "Te podemos orientar inicialmente con IMC (peso y estatura) y antecedentes de salud, pero la calificacion formal la determina evaluacion clinica y documentos exigidos por protocolo FONASA.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Usar como respuesta de triage: pedir peso, estatura, edad y prevision."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "me pueden confirmar horario exacto del doctor",
      "Respuesta aprobada":
        "Te ayudo a revisarlo, pero la confirmacion final de cupo y horario depende de agenda vigente en ese momento. Si quieres, te derivo para confirmacion inmediata.",
      "Cuando derivar a persona":
        "Derivar siempre que pidan confirmacion de hora exacta o bloqueo de cupo.",
      "No prometer":
        "No prometer cupo ni horario antes de confirmar en agenda activa.",
      "Notas para el bot":
        "Aprendido de conversaciones humanas: evitar compromisos de agenda sin validacion."
    },
    {
      Activo: "SI",
      "Pregunta frecuente": "donde veo prestadores en convenio pad",
      "Respuesta aprobada":
        "Puedes revisar prestadores en convenio PAD en el enlace oficial que publica FONASA: reddeproteccion.cl/bonopad. Si quieres, te ayudo a identificar el prestador segun tu ciudad.",
      "Cuando derivar a persona": commonEscalation,
      "No prometer": commonNoPromise,
      "Notas para el bot":
        "Fuente oficial enlazada en fichas FONASA PAD."
    }
  ];
}

function main() {
  const outputDir = path.resolve("data", "zendesk-exports");
  fs.mkdirSync(outputDir, { recursive: true });
  const rows = buildRows();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outputDir, `faq_curado_fuentes_${stamp}.tsv`);
  fs.writeFileSync(outPath, toTsv(rows), "utf8");
  console.log(`Curated FAQ seed generated: ${outPath}`);
  console.log(`Rows: ${rows.length}`);
}

main();

