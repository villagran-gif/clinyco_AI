(() => {
  let offset = 0, busy = false;
  const byId = id => document.getElementById(id);
  function cellLink(link, cell) {
    if (!link) { cell.append("—"); return; }
    const url = new URL(link.url);
    const allowed = url.origin === "https://app.chatwoot.com"
      ? /^\/app\/accounts\/162472\/(contacts|conversations)\/\d+$/.test(url.pathname)
      : url.origin === "https://clinyco.medinetapp.com" && /^\/pacientes\/ficha\/\d+\/\d+\/$/.test(url.pathname);
    if (!allowed || url.search || url.hash) throw new Error("Unexpected link");
    const a = document.createElement("a");
    a.href = url.href; a.textContent = link.text; a.target = "_blank";
    a.rel = "noopener noreferrer"; a.style.marginRight = "0.7rem"; cell.append(a);
  }
  let structureLoaded = false;
  async function loadStructure() {
    if (structureLoaded) return;
    try {
      const response = await fetch("crm-structure.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      const select = byId("crm-pipeline");
      select.replaceChildren();
      for (const pipeline of data.pipelines) {
        const option = document.createElement("option");
        option.value = pipeline.id; option.textContent = pipeline.name; select.append(option);
      }
      const render = () => {
        const pipeline = data.pipelines.find(item => item.id === select.value);
        byId("crm-structure-info").textContent = [
          pipeline.branches.length ? `Sedes: ${pipeline.branches.join(" · ")}` : "",
          pipeline.labels.length ? `Etiquetas: ${pipeline.labels.join(" · ")}` : ""
        ].filter(Boolean).join(". ");
        byId("crm-stages").replaceChildren();
        for (const stage of pipeline.stages) {
          const item = document.createElement("span");
          item.textContent = stage.name;
          item.style.cssText = "padding:8px 12px;border:1px solid #aab4c4;border-radius:6px";
          if (stage.group === "other") item.style.borderStyle = "dashed";
          byId("crm-stages").append(item);
        }
        byId("crm-structure-state").textContent = pipeline.id === "balon"
          ? "Allurion y Orbera son alternativas. Las etapas no se asignan automáticamente."
          : "Las etapas no se asignan automáticamente.";
      };
      select.onchange = render; render(); structureLoaded = true;
    } catch { byId("crm-structure-state").textContent = "No se pudo cargar la estructura de embudos."; }
  }
  window.loadCrm = async (more = false) => {
    if (busy) return;
    busy = true;
    await loadStructure();
    for (const id of ["crm-refresh","crm-more","crm-month"]) byId(id).disabled = true;
    if (!more) { offset = 0; byId("crm-rows").replaceChildren(); }
    byId("crm-state").textContent = "Cargando contactos…";
    try {
      const base = location.hostname === "localhost" ? "http://localhost:10000/api/review" : "/api";
      const response = await fetch(`${base}/crm/links?month=${encodeURIComponent(byId("crm-month").value)}&offset=${offset}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (!Array.isArray(data.links)) throw new Error("Invalid response");
      const fragment = document.createDocumentFragment();
      for (const item of data.links) {
        const tr = document.createElement("tr");
        const contact = tr.insertCell(), conversations = tr.insertCell(), record = tr.insertCell();
        cellLink(item.contact, contact);
        for (const link of item.conversations) cellLink(link, conversations);
        cellLink(item.record, record); fragment.append(tr);
      }
      byId("crm-rows").append(fragment);
      offset += data.links.length;
      byId("crm-more").hidden = data.links.length < 100;
      byId("crm-state").textContent = offset ? `${offset} contactos cargados` : "No hay contactos importados con actividad en este mes.";
    } catch { byId("crm-state").textContent = "No se pudo cargar el directorio. Intenta actualizar nuevamente."; }
    finally { busy = false; for (const id of ["crm-refresh","crm-more","crm-month"]) byId(id).disabled = false; }
  };
  byId("crm-refresh").addEventListener("click", () => window.loadCrm());
  byId("crm-more").addEventListener("click", () => window.loadCrm(true));
  byId("crm-month").addEventListener("change", () => window.loadCrm());
})();
