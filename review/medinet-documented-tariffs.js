const norm = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const fonasa = value => /\bfonasa\b|\btramo\s*[abcd]\b/.test(norm(value));
const particular = value => /\bparticular\b/.test(norm(value));
const freeType = value => /sin costo|s\/\s*costo|s\/c\b|s\.c\b/.test(norm(value));
const hit = (name, tokens) => tokens.every(token => name.includes(token));
const result = (amountClp, rule) => ({ amountClp, source: 'recepcion-2026-09-15', rule });

export function documentedTariff(appointment = {}) {
  const professional = norm(appointment.professional);
  const type = norm(appointment.type);
  const insurer = norm(appointment.prevision);

  if (freeType(type)) return result(0, 'tipo-sin-costo');
  if (hit(professional,['ingrid','yevenes'])) return result(60000,'ingrid-yevenes');
  if (hit(professional,['fernando','moya'])) return result(60000,'fernando-moya');
  if (hit(professional,['sofia','araya'])) return result(70000,'sofia-araya');
  if (hit(professional,['kather','araya'])) return result(48000,'katherine-araya');

  if (hit(professional,['magaly','cerquera']) || hit(professional,['mariapaz','plonka']) ||
      hit(professional,['gabriela','heck']) || hit(professional,['camila','alcayaga']))
    return result(28000,'nutricionista');

  if (hit(professional,['alvaro','pizarro'])) {
    if (/nuevo|evaluacion/.test(type)) return result(70000,'alvaro-pizarro-nuevo');
    if (/control|antigu/.test(type)) return result(56000,'alvaro-pizarro-antiguo');
    return null;
  }
  if (hit(professional,['perina','bencina'])) return result(70000,'perina-bencina');

  if (hit(professional,['peggy','huerta']) || hit(professional,['enzo','arias']) ||
      professional.includes('francisca')) return result(35000,'psicologia');

  if (hit(professional,['rodrigo','villagran']))
    return particular(insurer) ? result(50000,'rodrigo-particular') : null;
  if (hit(professional,['nelson','aros']))
    return particular(insurer) ? result(40000,'nelson-particular') : null;
  if (hit(professional,['edmundo','ziede'])) {
    if (fonasa(insurer)) return result(20000,'edmundo-fonasa');
    return particular(insurer) ? result(50000,'edmundo-particular') : null;
  }
  if (hit(professional,['francisco','bencina'])) {
    if (fonasa(insurer)) return result(20000,'francisco-bencina-fonasa');
    return particular(insurer) ? result(50000,'francisco-bencina-particular') : null;
  }
  if (hit(professional,['alberto','sirabo'])) return result(20000,'alberto-sirabo');

  if (hit(professional,['carlos','nunez']) || hit(professional,['carlos','nuñez']))
    return result(35000,'carlos-nunez');
  if (hit(professional,['pablo','ramos'])) return result(35000,'pablo-ramos');

  if (/bio\s*imped/.test(type) || /bio\s*imped/.test(professional))
    return result(23000,'bioimpedanciometria');
  if (/manometria anorectal/.test(type)) return result(410000,'manometria-anorectal');
  if (/phmetria/.test(type) && /sin impedancia/.test(type)) return result(252000,'phmetria-sin-impedancia');
  // El documento fuente dice literalmente "350.00" para PHmetría con impedancia.
  // Se deja sin tarifa hasta aclarar si corresponde a $350.000 u otro monto.
  if (/phmetria/.test(type) && /con impedancia/.test(type)) return null;

  return null;
}
