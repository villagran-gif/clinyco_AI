const CLINYCO_TABS = {
  "Equipo medico": {
    columnasBase: [
      "Orden web",
      "Nombre profesional",
      "Nombre en validacion",
      "Categoria operativa",
      "Especialidad web",
      "Descripcion web",
      "Estado validacion",
      "Horario",
      "Valor",
      "Previo pago",
      "Duracion",
      "Edad",
      "Telemedicina",
      "Sobrecupo",
      "Revision de examenes",
      "Observaciones"
    ],
    columnasFeedback: ["Interpretacion IA", "Estado IA", "Observaciones IA"],
    columnasRequeridas: ["Nombre profesional"],
    columnasPrincipal: ["Nombre profesional", "Nombre en validacion"]
  },
  "sedes": {
    columnasBase: ["Activo", "Sede", "Ciudad", "Modalidad", "Direccion", "Agenda web", "Solo telemedicina", "Observaciones", "Notas para el bot"],
    columnasFeedback: ["Interpretacion IA", "Estado IA", "Observaciones IA"],
    columnasRequeridas: ["Activo", "Sede"],
    columnasPrincipal: ["Sede"]
  },
  "profesionales": {
    columnasBase: ["Activo", "Profesional", "Especialidad", "Sedes", "Modalidad", "Procedimientos", "Agenda directa disponible", "Observaciones", "Notas para el bot", "Horario", "Valor", "Previo pago", "Duracion", "Telemedicina", "Motivo inactividad", "Mensaje para el cliente"],
    columnasFeedback: ["Interpretacion IA", "Estado IA", "Observaciones IA"],
    columnasRequeridas: ["Activo", "Profesional"],
    columnasPrincipal: ["Profesional"]
  },
  "examenes": {
    columnasBase: ["Activo", "Examen o evaluacion", "Categoria", "Requiere peso y estatura", "Se puede orientar sin RUT", "Profesionales sugeridos", "Sedes sugeridas", "Observaciones", "Notas para el bot"],
    columnasFeedback: ["Interpretacion IA", "Estado IA", "Observaciones IA"],
    columnasRequeridas: ["Activo", "Examen o evaluacion"],
    columnasPrincipal: ["Examen o evaluacion"]
  },
  "reglas_de_cobertura": {
    columnasBase: ["Activo", "Cobertura o prevision", "Modalidad", "Regla simple para el bot", "Que dato pedir despues", "Observaciones internas"],
    columnasFeedback: ["Interpretacion IA", "Estado IA", "Observaciones IA"],
    columnasRequeridas: ["Activo", "Cobertura o prevision", "Regla simple para el bot"],
    columnasPrincipal: ["Cobertura o prevision"]
  },
  "preguntas frecuentes": {
    columnasBase: ["Activo", "Pregunta frecuente", "Respuesta aprobada", "Cuando derivar a persona", "No prometer", "Notas para el bot"],
    columnasFeedback: ["Interpretacion IA", "Estado IA", "Observaciones IA"],
    columnasRequeridas: ["Activo", "Pregunta frecuente", "Respuesta aprobada"],
    columnasPrincipal: ["Pregunta frecuente"]
  }
};

const LOG_SHEET_NAME = "Bitacora IA";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Clinyco IA")
    .addItem("Preparar hoja actual", "prepararHojaActual")
    .addItem("Validar hoja actual", "validarHojaActual")
    .addToUi();
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const tabName = sheet.getName();
    if (!CLINYCO_TABS[tabName]) return;
    if (e.range.getRow() < 2) return;
    asegurarColumnasFeedback_(sheet, tabName);
    const resultado = validarFila_(sheet, tabName, e.range.getRow());
    registrarBitacora_({
      action: "edicion",
      sheet,
      tabName,
      rowNumber: e.range.getRow(),
      columnNumber: e.range.getColumn(),
      oldValue: e.oldValue || "",
      newValue: e.value || "",
      resultado
    });
  } catch (error) {
    SpreadsheetApp.getActiveSpreadsheet().toast(`Error onEdit: ${error.message}`, "Clinyco IA", 8);
  }
}

function prepararHojaActual() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const tabName = sheet.getName();
    if (!CLINYCO_TABS[tabName]) {
      SpreadsheetApp.getUi().alert("Esta pestaña no está configurada para Clinyco IA.");
      return;
    }
    asegurarColumnasFeedback_(sheet, tabName);
    aplicarFormatoBase_(sheet);
    aplicarValidaciones_(sheet, tabName);
    registrarBitacora_({
      action: "preparar_hoja",
      sheet,
      tabName,
      rowNumber: null,
      columnNumber: null,
      oldValue: "",
      newValue: "",
      resultado: {
        interpretacion: "Hoja preparada con validaciones.",
        estado: "OK",
        feedback: "Preparación completada."
      }
    });
    SpreadsheetApp.getUi().alert("Se agregaron columnas de feedback y validaciones guiadas para esta pestaña.");
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error al preparar la hoja: ${error.message}`);
  }
}

function validarHojaActual() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const tabName = sheet.getName();
    if (!CLINYCO_TABS[tabName]) {
      SpreadsheetApp.getUi().alert("Esta pestaña no está configurada para Clinyco IA.");
      return;
    }
    asegurarColumnasFeedback_(sheet, tabName);
    const lastRow = sheet.getLastRow();
    let filasRevisar = 0;
    for (let row = 2; row <= lastRow; row += 1) {
      const resultado = validarFila_(sheet, tabName, row);
      if (resultado && resultado.estado === "Revisar") filasRevisar += 1;
    }
    registrarBitacora_({
      action: "validar_hoja",
      sheet,
      tabName,
      rowNumber: null,
      columnNumber: null,
      oldValue: "",
      newValue: "",
      resultado: {
        interpretacion: `Validación masiva en ${tabName}`,
        estado: filasRevisar ? "Revisar" : "OK",
        feedback: filasRevisar ? `Quedaron ${filasRevisar} filas para revisar.` : "Todas las filas quedaron OK."
      }
    });
    SpreadsheetApp.getUi().alert("Validación terminada.");
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error al validar la hoja: ${error.message}`);
  }
}

function asegurarColumnasFeedback_(sheet, tabName) {
  const headers = obtenerHeaders_(sheet);
  const feedbackHeaders = CLINYCO_TABS[tabName].columnasFeedback;
  let changed = false;
  feedbackHeaders.forEach((header) => {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      changed = true;
    }
  });
  if (changed) {
    const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#0E8A6A");
    headerRange.setFontColor("#FFFFFF");
    headerRange.setWrap(true);
  }
}

function aplicarFormatoBase_(sheet) {
  sheet.setFrozenRows(1);
  try {
    if (sheet.getLastColumn() > 0 && sheet.getLastRow() > 0) {
      const existingFilter = sheet.getFilter();
      if (existingFilter) {
        existingFilter.remove();
      }
      sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), sheet.getLastColumn()).createFilter();
    }
  } catch (error) {
    // Algunos archivos importados desde Excel fallan al recrear filtros.
  }
  try {
    sheet.autoResizeColumns(1, Math.max(sheet.getLastColumn(), 1));
  } catch (error) {
    // Si falla el auto resize, no bloqueamos el resto.
  }
}

function aplicarValidaciones_(sheet, tabName) {
  const headers = obtenerHeaders_(sheet);
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  const helpers = {
    booleano: SpreadsheetApp.newDataValidation()
      .requireValueInList(["SI", "NO"], true)
      .setAllowInvalid(false)
      .setHelpText("Escribe solo SI o NO.")
      .build(),
    telemedicina: SpreadsheetApp.newDataValidation()
      .requireValueInList(["SI", "NO", "SOLO TELEMEDICINA", "PRESENCIAL Y TELEMEDICINA"], true)
      .setAllowInvalid(false)
      .setHelpText("Usa una de estas opciones para que el bot entienda la modalidad.")
      .build(),
    duracion: SpreadsheetApp.newDataValidation()
      .requireTextContains("min")
      .setAllowInvalid(true)
      .setHelpText("Ejemplo: 30 min.")
      .build()
  };

  const headersBooleanos = [
    "Activo",
    "Solo telemedicina",
    "Agenda directa disponible",
    "Requiere peso y estatura",
    "Se puede orientar sin RUT",
    "Previo pago"
  ];

  headers.forEach((header, index) => {
    const column = index + 1;
    const range = sheet.getRange(2, column, maxRows, 1);

    if (headersBooleanos.indexOf(header) >= 0) {
      range.setDataValidation(helpers.booleano);
      return;
    }

    if (header === "Telemedicina") {
      range.setDataValidation(helpers.telemedicina);
      return;
    }

    if (header === "Duracion") {
      range.setDataValidation(helpers.duracion);
      return;
    }

    if (header === "Valor") {
      sheet.getRange(1, column).setNote("Ejemplos recomendados: 70000 o 70 mil. Evitar frases largas.");
      return;
    }
  });
}

function obtenerHeaders_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((value) => String(value || "").trim());
}

function leerFilaComoObjeto_(sheet, rowNumber) {
  const headers = obtenerHeaders_(sheet);
  const values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const record = {};
  headers.forEach((header, index) => {
    record[header] = values[index];
  });
  return { headers, record };
}

function textoCelda_(value) {
  return String(value || "").trim();
}

function filaTieneContenido_(record, headers) {
  return headers.some((header) => {
    if (["Interpretacion IA", "Estado IA", "Observaciones IA"].indexOf(header) >= 0) return false;
    return textoCelda_(record[header]) !== "";
  });
}

function obtenerColumnasRequeridas_(tabName) {
  return CLINYCO_TABS[tabName]?.columnasRequeridas || [];
}

function obtenerPrincipal_(record, tabName) {
  const preferred = CLINYCO_TABS[tabName]?.columnasPrincipal || [];
  for (let i = 0; i < preferred.length; i += 1) {
    const value = textoCelda_(record[preferred[i]]);
    if (value) return value;
  }

  return (
    textoCelda_(record["Nombre profesional"]) ||
    textoCelda_(record["Profesional"]) ||
    textoCelda_(record["Examen o evaluacion"]) ||
    textoCelda_(record["Procedimiento"]) ||
    textoCelda_(record["Sede"]) ||
    textoCelda_(record["Cobertura o prevision"]) ||
    textoCelda_(record["Pregunta frecuente"]) ||
    tabName
  );
}

function normalizarBooleano_(value) {
  const text = String(value || "").trim();
  const key = limpiarClave_(text);
  if (!key) return { label: "", notes: ["Vacío."] };
  if (["SI", "S", "TRUE", "1"].indexOf(key) >= 0) return { label: "Si", notes: [] };
  if (["NO", "N", "FALSE", "0"].indexOf(key) >= 0) return { label: "No", notes: [] };
  if (key.indexOf("NO REALIZA TELEMEDICINA") >= 0) return { label: "No", notes: ["Interpretado desde texto libre."] };
  if (key.indexOf("SOLO TELEMEDICINA") >= 0 || key.indexOf("TELEMEDICINA SI") >= 0) return { label: "Si", notes: ["Interpretado desde texto libre."] };
  return { label: "", notes: ["No quedó claro si es Si o No."] };
}

function normalizarMonto_(value) {
  const text = String(value || "").trim();
  const key = limpiarClave_(text);
  const matches = text.match(/\d[\d.,]*/g) || [];
  if (!matches.length) return { label: "", notes: [] };
  const hasMil = key.indexOf("MIL") >= 0;
  const amounts = [];
  matches.forEach((match) => {
    let digits = String(match).replace(/[^\d]/g, "");
    if (!digits) return;
    let amount = Number(digits);
    if (!isFinite(amount) || amount <= 0) return;
    if (hasMil && amount < 1000) amount *= 1000;
    if (amounts.indexOf(amount) === -1) amounts.push(amount);
  });
  if (!amounts.length) return { label: "", notes: ["No entendí el valor."] };
  const notes = [];
  if (amounts.length > 1) notes.push("Detecté más de un monto en la misma celda.");
  if (amounts[0] < 1000 && !hasMil) notes.push("Monto muy bajo para CLP. Revisar si faltó escribir mil o miles.");
  return { label: "$" + formatearNumero_(amounts[0]) + " CLP", notes };
}

function normalizarDuracion_(value) {
  const text = String(value || "").trim();
  const matches = [...text.matchAll(/(\d{1,3})\s*(?:min|minutos?)/gi)];
  if (!matches.length) return { label: "", notes: [] };
  const unique = [];
  matches.forEach((match) => {
    const amount = Number(match[1]);
    if (isFinite(amount) && unique.indexOf(amount) === -1) unique.push(amount);
  });
  const notes = unique.length > 1 ? ["Detecté más de una duración en la misma celda."] : [];
  return { label: unique[0] + " min", notes };
}

function normalizarTelemedicina_(value) {
  const text = String(value || "").trim();
  const key = limpiarClave_(text);
  if (!key) return { label: "", notes: [] };
  if (key.indexOf("NO REALIZA TELEMEDICINA") >= 0 || key === "NO") return { label: "No", notes: [] };
  if (key.indexOf("SOLO TELEMEDICINA") >= 0) return { label: "Solo telemedicina", notes: [] };
  if ((key.indexOf("TELEMEDICINA") >= 0 && key.indexOf("PRESENCIAL") >= 0) || key.indexOf("HIBRIDO") >= 0) {
    return { label: "Presencial y telemedicina", notes: ["Detecté modalidad mixta."] };
  }
  if (key.indexOf("TELEMEDICINA") >= 0 || key === "SI") return { label: "Si", notes: ["Interpretado desde texto libre."] };
  return { label: "", notes: ["No entendí la modalidad de telemedicina."] };
}

function limpiarClave_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function formatearNumero_(value) {
  return Utilities.formatString("%s", value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function validarFila_(sheet, tabName, rowNumber) {
  const row = leerFilaComoObjeto_(sheet, rowNumber);
  const headers = row.headers;
  const record = row.record;
  if (!filaTieneContenido_(record, headers)) {
    escribirFeedback_(sheet, headers, rowNumber, {
      "Interpretacion IA": "",
      "Estado IA": "",
      "Observaciones IA": ""
    });
    return {
      interpretacion: "",
      estado: "",
      feedback: ""
    };
  }

  const notes = [];
  const chunks = [];
  const requiredHeaders = obtenerColumnasRequeridas_(tabName);
  const missingRequired = requiredHeaders.filter((header) => textoCelda_(record[header]) === "");

  if (missingRequired.length) {
    notes.push("Faltan campos obligatorios: " + missingRequired.join(", ") + ".");
  }

  if (record["Valor"]) {
    const monto = normalizarMonto_(record["Valor"]);
    if (monto.label) chunks.push("valor=" + monto.label);
    notes.push.apply(notes, monto.notes);
  }

  if (record["Duracion"]) {
    const duracion = normalizarDuracion_(record["Duracion"]);
    if (duracion.label) chunks.push("duracion=" + duracion.label);
    notes.push.apply(notes, duracion.notes);
  }

  if (record["Previo pago"]) {
    const previo = normalizarBooleano_(record["Previo pago"]);
    if (previo.label) chunks.push("previo_pago=" + previo.label);
    notes.push.apply(notes, previo.notes);
  }

  if (record["Telemedicina"]) {
    const tele = normalizarTelemedicina_(record["Telemedicina"]);
    if (tele.label) chunks.push("telemedicina=" + tele.label);
    notes.push.apply(notes, tele.notes);
  }

  if (record["Activo"] !== "") {
    const activo = normalizarBooleano_(record["Activo"]);
    if (activo.label) chunks.push("activo=" + activo.label);
    notes.push.apply(notes, activo.notes);

    if (activo.label === "No") {
      if (!textoCelda_(record["Motivo inactividad"])) {
        notes.push("Si está inactivo, falta completar Motivo inactividad.");
      }
      if (!textoCelda_(record["Mensaje para el cliente"])) {
        notes.push("Si está inactivo, falta completar Mensaje para el cliente.");
      }
    }
  }

  const principal = obtenerPrincipal_(record, tabName);

  const interpretacion = chunks.length ? principal + ": " + chunks.join(" | ") : principal;
  const estado = notes.length ? "Revisar" : "OK";
  const feedback = notes.length ? notes.join(" | ") : "Interpretación clara.";

  escribirFeedback_(sheet, headers, rowNumber, {
    "Interpretacion IA": interpretacion,
    "Estado IA": estado,
    "Observaciones IA": feedback
  });

  return {
    interpretacion,
    estado,
    feedback
  };
}

function escribirFeedback_(sheet, headers, rowNumber, values) {
  Object.keys(values).forEach((header) => {
    const index = headers.indexOf(header);
    if (index === -1) return;
    const cell = sheet.getRange(rowNumber, index + 1);
    cell.setValue(values[header]);
    if (header === "Estado IA") {
      if (values[header] === "OK") {
        cell.setBackground("#C6EFCE");
      } else {
        cell.setBackground("#FFF2CC");
      }
    }
  });

  const activoIndex = headers.indexOf("Activo");
  if (activoIndex >= 0) {
    const activoCell = sheet.getRange(rowNumber, activoIndex + 1);
    const activo = normalizarBooleano_(sheet.getRange(rowNumber, activoIndex + 1).getValue()).label;
    if (activo === "Si") {
      activoCell.setBackground("#C6EFCE");
    } else if (activo === "No") {
      activoCell.setBackground("#F4CCCC");
    } else {
      activoCell.setBackground(null);
    }
  }
}

function obtenerCorreoVisible_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || "correo_no_visible";
  } catch (error) {
    return "correo_no_visible";
  }
}

function obtenerNombreColumna_(sheet, columnNumber) {
  if (!columnNumber) return "";
  return textoCelda_(sheet.getRange(1, columnNumber).getValue());
}

function obtenerBitacoraSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(LOG_SHEET_NAME);
    sheet.appendRow([
      "Fecha",
      "Responsable visible",
      "Accion",
      "Pestaña",
      "Fila",
      "Columna",
      "Encabezado",
      "Valor anterior",
      "Valor nuevo",
      "Interpretacion IA",
      "Estado IA",
      "Observaciones IA"
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function registrarBitacora_({ action, sheet, tabName, rowNumber, columnNumber, oldValue, newValue, resultado }) {
  const spreadsheet = sheet.getParent();
  const logSheet = obtenerBitacoraSheet_(spreadsheet);
  const actor = obtenerCorreoVisible_();
  logSheet.appendRow([
    new Date(),
    actor,
    action || "",
    tabName || "",
    rowNumber || "",
    columnNumber || "",
    obtenerNombreColumna_(sheet, columnNumber),
    oldValue || "",
    newValue || "",
    resultado?.interpretacion || "",
    resultado?.estado || "",
    resultado?.feedback || ""
  ]);
}
