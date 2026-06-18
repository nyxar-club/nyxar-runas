// Definición única de premios — la usan tanto la app de cliente como el panel admin.
// Las probabilidades están en fracción exacta (1/6 en vez de 16.6%) para que la suma
// cierre en 100% sin redondeos raros.
export const RUNES_PER_SPIN = 6;

export const PRIZES = [
  { key: "descuento",            label: "Descuento exclusivo 16%",   prob: 1 / 6 },
  { key: "accesorio_dorado",     label: "Accesorio dorado",          prob: 1 / 6 },
  { key: "accesorio_plateado",   label: "Accesorio plateado",        prob: 1 / 6 },
  { key: "envio_gratis",         label: "Envío gratis",              prob: 0.36 },
  { key: "prenda_basica",        label: "Prenda básica Nyxar",       prob: 0.10 },
  { key: "prenda_catalogo",      label: "Prenda del catálogo",       prob: 0.03 },
  { key: "prenda_personalizada", label: "Prenda personalizada",      prob: 0.01 },
];

// Construye los segmentos con su ángulo de inicio y barrido, en el mismo orden
// que el arreglo anterior. startAngle=0 es la posición de las 12 (arriba).
export function buildSegments() {
  let acc = 0;
  return PRIZES.map((p) => {
    const startAngle = acc;
    const sweep = p.prob * 360;
    acc += sweep;
    return { ...p, startAngle, sweep };
  });
}

// Elige un premio al azar respetando las probabilidades definidas arriba.
export function pickWeightedPrize() {
  const r = Math.random();
  let acc = 0;
  for (const p of PRIZES) {
    acc += p.prob;
    if (r <= acc) return p;
  }
  return PRIZES[PRIZES.length - 1];
}

export function prizeLabel(key) {
  const found = PRIZES.find((p) => p.key === key);
  return found ? found.label : key;
}
