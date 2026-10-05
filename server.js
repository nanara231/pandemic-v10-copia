// Pandemic: La cura - servidor multijugador (solo módulos de Node, sin npm install)
const http = require('http'), fs = require('fs'), path = require('path');
const C = ['blue', 'yellow', 'black', 'red'];
const NAME = { blue: 'azul', yellow: 'amarillo', black: 'negro', red: 'rojo' };
const REGIONS = ['Norteamérica', 'Europa', 'Asia', 'Oceanía', 'África', 'Sudamérica'];
// Caras de los dados de infección (número = región, X = cruz). Aproximación del dado real.
// Caras reales de los dados. 0 = cara (+): el dado va al CDC. El resto es el número de región.
const FACES = { blue: [0, 1, 2, 4, 6, 6], yellow: [0, 2, 2, 4, 5, 5], black: [0, 3, 3, 3, 4, 5], red: [0, 1, 1, 4, 6, 6] };
// Caras de los dados de jugador de cada personaje (6 caras, cada una con probabilidad 1/6).
// 'a|b' = cara dividida (línea diagonal): al usarla eliges UNA de las dos acciones.
// treat2/treat3 = 2 o 3 acciones de tratar con un solo dado. cross = cara (+) del planificador. contain = devolver dados a la bolsa. heli = vuelo de emergencia.
const ROLEFACES = {
  generalist: ['fly', 'sample', 'treat', 'treat', 'sail', 'bio'],
  analyst: ['treat', 'sample', 'treat', 'sail', 'sail|sample', 'bio'],
  planner: ['fly', 'sample', 'sail|treat', 'cross', 'treat', 'bio'],
  medic: ['fly', 'sample', 'treat2', 'treat3', 'sail|treat', 'bio'],
  containment: ['fly', 'sample', 'sail', 'contain', 'treat', 'bio'],
  geneticist: ['sail', 'sample', 'treat', 'sail|treat', 'sail|sample', 'bio'],
  coordinator: ['fly', 'sample', 'fly|treat', 'treat', 'heli', 'bio']
};
// true = si no hay dados suficientes en la bolsa se pierde (regla impresa). false = se roba lo que quede y se sigue.
const BAG_EMPTY_LOSES = true;
// Pista de infección: 7 tramos de 4 huecos. Dados que se roban en cada tramo = hexágonos del tablero.
const HEX = [3, 3, 3, 4, 4, 5, 5], END = 28; // END = calavera
const rooms = {};
const rnd = n => Math.floor(Math.random() * n);
const roll = c => FACES[c][rnd(6)];
const log = (r, t) => { r.log.push(t); if (r.log.length > 40) r.log.shift(); };
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

// ---- Roles de personaje (7, como en el juego real; se reparten al azar sin repetir) ----
const ROLES = {
  generalist: { n: 'Polivalente', col: '#5b6472', ico: '🧰', d: 'Tiene 7 dados. El primer ☣ que obtiene en cada turno no hace avanzar la jeringa del nivel de propagación.' },
  analyst: { n: 'Enlace de muestras', col: '#8b5a2b', ico: '📊', d: 'En cualquier momento puede entregar muestras a otros jugadores situados en cualquier región, sin coste.' },
  planner: { n: 'Estratega de crisis', col: '#1593ad', ico: '🧭', d: 'Con la cara ➕ cambia el resultado de 1 dado de infección de su región o del centro de tratamiento por la cara (+) y lo coloca en el CDC.' },
  medic: { n: 'Sanitario de campo', col: '#e0791a', ico: '⚕️', d: 'Con sus caras especiales realiza 2 o 3 acciones de tratar con un solo dado.' },
  containment: { n: 'Barrera biológica', col: '#b08d57', ico: '🛡️', d: 'Cuando entra en una región, lleva al centro de tratamiento 1 dado de cada color que tenga 2 o más dados allí. Con su cara especial devuelve a la bolsa hasta 3 dados del centro de tratamiento.' },
  geneticist: { n: 'Biólogo molecular', col: '#7d8fb0', ico: '🧬', d: 'Suma +2 a su tirada cuando intenta encontrar una cura en su región.' },
  coordinator: { n: 'Jefe de logística', col: '#c23a86', ico: '🚁', d: 'Durante su turno mueve a otros peones de su región a cualquier otra región sin coste. Con la cara de helicóptero guarda un Vuelo de emergencia: en cualquier momento mueve a todos los jugadores de una región a otra.' }
};
// ---- Cartas de evento (10; 3 visibles). Se pagan con dados del CDC, que vuelven a la bolsa. Las puede jugar cualquiera en cualquier momento. ----
// args: who/from/recv = jugador, to/reg/reg2 = región, c/c2 = color, i = dado con biorriesgo pendiente, k = cantidades por color, ch = dados a cambiar
const EVD = {
  quiet: { n: 'Una noche tranquila', cost: 3, col: '#d6334a', d: 'Puedes saltarte la fase de infectar regiones de este turno.', args: [] },
  healthy: { n: 'Población sana', cost: 2, col: '#22a06b', d: 'Cuando intentes descubrir una cura, puedes volver a lanzar uno de tus dados de muestra.', args: ['rd'] },
  attempt: { n: 'Intento de contención', cost: 1, col: '#8a4fd6', d: 'Puedes volver a lanzar un dado de jugador que haya obtenido un biorriesgo antes de que se aplique su efecto.', args: ['i'] },
  mobile: { n: 'Hospital móvil', cost: 2, col: '#26b0e0', d: 'Puedes mover 2 dados de infección de cualquier región al Centro de Tratamiento.', args: ['reg', 'c', 'reg2', 'c2'] },
  plans: { n: 'Cambio de planes', cost: 3, col: '#e03a5a', d: 'Puedes elegir el resultado de 1, 2 o 3 dados de jugador. No puedes cambiar los biorriesgos si ya se han tirado y ha salido alguno.', args: ['ch'] },
  supplies: { n: 'Suministros urgentes', cost: 1, col: '#e0b72a', d: 'Puedes devolver un dado a la bolsa de infección en lugar de tirarlo al infectar regiones o en una tirada de epidemia.', args: [] },
  community: { n: 'Apoyo de la comunidad', cost: 2, col: '#e0357f', d: 'Cada vez que entres en una nueva región, mueve un dado de infección al Centro de Tratamiento (hasta el final de este turno).', args: [] },
  coop: { n: 'Cooperación global', cost: 2, col: '#8da0b4', d: 'Puedes entregar cualquier cantidad de muestras de un jugador a otro, sin importar dónde se encuentren.', args: ['from', 'recv', 'k'] },
  disinfect: { n: 'Gran desinfección', cost: 1, col: '#2f7de0', d: 'Puedes mover hasta 4 dados del Centro de Tratamiento a la bolsa de infección.', args: ['k'] },
  extra: { n: 'Recursos extra', cost: 1, col: '#8a4fd6', d: 'Puedes mover un peón a cualquier región.', args: ['who', 'to'] }
};

function lose(r, why) { if (!r.over) { r.over = 'lose'; log(r, 'DERROTA: ' + why); } }
function draw(r, n) {
  const k = Math.min(n, r.bag.length);
  if (k < n) {
    if (BAG_EMPTY_LOSES) { lose(r, 'no quedan dados en la bolsa (demasiada gente infectada).'); return []; }
    log(r, k ? 'La bolsa se queda corta: solo se roban ' + k + ' de ' + n + ' dados.' : 'La bolsa está vacía: no se roba ningún dado.');
  }
  const out = []; for (let i = 0; i < k; i++) out.push(r.bag.splice(rnd(r.bag.length), 1)[0]); return out;
}
// Si hay Suministros urgentes activos, la infección se pausa para que el jugador devuelva un dado a la bolsa (resume: 'end' = fin de turno, 'bio' = epidemia durante biorriesgos)
function infect(r, dice, resume) {
  // La infección SIEMPRE se resuelve manualmente: primero se pulsa "Tirar dados"
  // y después se coloca cada dado en la región que indique su número.
  // Esto también se aplica a los dados de una epidemia.
  if (dice.length && !r.over) {
    r.pi = { dice: dice.slice(), resume, rolled: false };
    log(r, resume === 'bio' ? 'Epidemia: dados preparados para tirada manual.' : 'Infección: dados preparados para tirada manual.');
    return;
  }
  if (!dice.length && resume === 'end') endTurn(r);
}
function resolvePi(r, p, c) {
  const pi = r.pi; if (!pi) return 'No hay ninguna infección pendiente.';
  // Primero se tiran los dados y se muestran sus resultados. Después el jugador los coloca uno a uno.
  if (!pi.rolled) {
    pi.dice = pi.dice.map(col => ({ c: col, n: roll(col), placed: false }));
    pi.rolled = true;
    log(r, 'Dados de infección tirados: ' + pi.dice.map(d => NAME[d.c] + ' = ' + (d.n === 0 ? '+' : d.n)).join(', ') + '.');
    finishPiPlacement(r, p);
    return;
  }
  if (c) {
    if (!C.includes(c)) return 'Color no válido.';
    if (!(r.supply > 0)) return 'No tienes Suministros urgentes activos.';
    const k = pi.dice.findIndex(d => d.c === c && !d.placed);
    if (k < 0) return 'No hay un dado de ese color sin colocar.';
    pi.dice.splice(k, 1); r.bag.push(c); r.supply--; log(r, 'Suministros urgentes: un dado ' + NAME[c] + ' vuelve a la bolsa sin tirarse.');
  }
  return finishPiPlacement(r, p);
}
function placePiDie(r, p, i, reg, cdc) {
  const pi = r.pi; if (!pi || !pi.rolled) return 'Primero tira los dados de infección.';
  if (!Number.isInteger(i) || i < 0 || i >= pi.dice.length) return 'Dado de infección no válido.';
  const d = pi.dice[i]; if (d.placed) return 'Ese dado ya está colocado.';
  if (d.n === 0) {
    if (!cdc) return 'La cara (+) debe enviarse al CDC.';
    r.cdc[d.c]++; d.placed = true;
    log(r, 'Cara (+) (' + NAME[d.c] + '): dado colocado manualmente en el CDC.');
    return finishPiPlacement(r, p);
  }
  if (!regOk(reg) || reg !== d.n - 1) return 'Ese dado solo puede colocarse en la región ' + d.n + '.';
  if (!place(r, reg, d.c, 1, d.n)) log(r, 'Protegida: un dado ' + NAME[d.c] + ' vuelve a la bolsa');
  d.placed = true;
  log(r, 'Infección: dado ' + NAME[d.c] + ' (' + d.n + ') colocado en ' + REGIONS[reg] + '.');
  return finishPiPlacement(r, p);
}

function finishPiPlacement(r, p) {
  const pi = r.pi; if (!pi) return;
  if (pi.dice.length && pi.dice.every(d => d.placed)) {
    const dice = pi.dice.slice();
    r.pi = null;
    outbreaks(r);
    if (r.over) return;
    if (pi.resume === 'bio') runBio(r, p); else if (pi.resume === 'end') endTurn(r);
  }
}
function doInfect(r, dice) {
  dice.forEach(c => { const f = roll(c); if (f === 0) { r.cdc[c]++; log(r, 'Cara (+) (' + NAME[c] + '): dado al CDC'); } else if (!place(r, f - 1, c, 1)) log(r, 'Protegida: un dado ' + NAME[c] + ' vuelve a la bolsa'); });
  outbreaks(r);
}
function outbreaks(r) {
  let ch = true;
  const fxRegions = [];
  while (ch && !r.over) {
    ch = false;
    for (let i = 0; i < 6 && !r.over; i++) for (const c of C) if (r.reg[i][c] > 3) {
      const ex = r.reg[i][c] - 3;
      r.reg[i][c] = 3;
      if (!r.regd) r.regd = Array.from({ length: 6 }, () => ({ blue: [], yellow: [], black: [], red: [] }));
      const src = r.regd[i][c] || [];
      const movedFaces = src.splice(Math.max(0, src.length - ex), ex);
      while (src.length > 3) src.shift();
      const ok = blocked(r, (i + 1) % 6, c) ? false : (r.reg[(i + 1) % 6][c] += ex, (r.regd[(i + 1) % 6][c] ||= []).push(...(movedFaces.length ? movedFaces : Array(ex).fill(i + 1))), true);
      if (!ok) for (let k = 0; k < ex; k++) r.bag.push(c);
      r.out++; ch = true;
      fxRegions.push(i);
      log(r, 'BROTE en ' + REGIONS[i] + ' (' + NAME[c] + '): ' + ex + ' a ' + REGIONS[(i + 1) % 6] + (ok ? '' : ' (bloqueado, vuelve a la bolsa)'));
      if (r.out >= 8) lose(r, '8 brotes.');
    }
  }
  if (fxRegions.length) {
    r.fxSeq = (r.fxSeq || 0) + 1;
    r.fx = { seq: r.fxSeq, epidemic: false, outbreaks: [...new Set(fxRegions)] };
  }
}

function addInf(r, k) {
  for (let i = 0; i < k && !r.over; i++) {
    r.rate++;
    if (r.rate >= END) { lose(r, 'la tasa de infección llegó al final.'); return; }
    if (r.rate % 4 === 0) { r.fxSeq = (r.fxSeq || 0) + 1; r.fx = { seq: r.fxSeq, epidemic: true, outbreaks: [] }; log(r, 'EPIDEMIA'); const t = r.treat.splice(0); infect(r, t.concat(draw(r, HEX[r.rate >> 2])), 'bio'); }
  }
}
// ---- Roles: protección, movimiento y pasivas ----
function blocked(r, i, c) { return r.shield === i; }
function place(r, i, c, n, face) { // true si los cubos se colocan; si no, vuelven a la bolsa
  if (blocked(r, i, c)) { for (let k = 0; k < n; k++) r.bag.push(c); return false; }
  r.reg[i][c] += n;
  if (!r.regd) r.regd = Array.from({ length: 6 }, () => ({ blue: [], yellow: [], black: [], red: [] }));
  const f = Number.isInteger(face) ? face : i + 1;
  for (let k = 0; k < n; k++) r.regd[i][c].push(f);
  return true;
}
function takeRegDie(r, i, c) {
  if (r.reg[i][c] <= 0) return null;
  r.reg[i][c]--;
  if (!r.regd) r.regd = Array.from({ length: 6 }, () => ({ blue: [], yellow: [], black: [], red: [] }));
  const a = r.regd[i][c] || [];
  return a.length ? a.pop() : i + 1;
}
// Apoyo de la comunidad: cola de elecciones. Si en la región solo hay un color no hay nada que elegir y se mueve solo.
function addTreatDie(r, c, logMsg) {
  // Regla global: una enfermedad curada nunca entra al Centro de Tratamiento.
  // Cualquier dado de ese color que intente entrar va directamente a la bolsa.
  if (r.cured[c]) {
    r.bag.push(c);
    if (logMsg) log(r, logMsg + ' La enfermedad está curada: el dado va directamente a la bolsa.');
    return false;
  }
  r.treat.push(c);
  if (logMsg) log(r, logMsg);
  return true;
}
function ccMove(r, q, to, c) { takeRegDie(r, to, c); addTreatDie(r, c, 'Apoyo de la comunidad: ' + q.name + ' lleva un dado ' + NAME[c] + ' de ' + REGIONS[to] + ' al centro.'); }
function ccAdvance(r) {
  while (r.cc && r.cc.length) {
    const h = r.cc[0], cols = C.filter(c => r.reg[h.to][c] > 0);
    if (!cols.length) { r.cc.shift(); continue; }
    if (cols.length === 1) { ccMove(r, r.players[h.who], h.to, cols[0]); r.cc.shift(); continue; }
    return;
  }
}
function resolveCc(r, c) {
  const h = r.cc && r.cc[0]; if (!h) return 'No hay ninguna elección pendiente.';
  if (!C.includes(c) || !(r.reg[h.to][c] > 0)) return 'Elige un color que haya en esa región.';
  ccMove(r, r.players[h.who], h.to, c); r.cc.shift(); ccAdvance(r);
}
function moveTo(r, q, to) {
  const was = q.region; q.region = to;
  if (was !== to && r.comm && r.comm.includes(q.id)) { (r.cc = r.cc || []).push({ who: q.id, to }); ccAdvance(r); } // Apoyo de la comunidad: el jugador elige qué dado va al centro
  if (q.role === 'containment') { // al entrar: 1 dado de cada color con 2+ dados en la región va al centro de tratamiento
    C.forEach(c => { if (r.reg[to][c] >= 2) { takeRegDie(r, to, c); addTreatDie(r, c, q.name + ' (' + ROLES.containment.n + ') lleva un dado ' + NAME[c] + ' de ' + REGIONS[to] + ' al centro.'); } });
  }
}
function passive() {}
const pl = (r, i) => Number.isInteger(i) ? r.players[i] : undefined;
const regOk = x => Number.isInteger(x) && x >= 0 && x < 6;
const cdcN = r => C.reduce((s, c) => s + r.cdc[c], 0);
// El jugador elige qué dados del CDC se devuelven a la bolsa para pagar un evento.
function payCheck(r, cost, pay) {
  if (!Array.isArray(pay) || pay.length !== cost) return 'Elige qué ' + cost + ' dado(s) del CDC devolver a la bolsa.';
  const t = Object.assign({}, r.cdc);
  for (const c of pay) { if (!C.includes(c) || !(t[c] > 0)) return 'No hay tantos dados de ese color en el CDC.'; t[c]--; }
}
function pay(r, pay) { pay.forEach(c => { r.cdc[c]--; r.bag.push(c); }); }
// Cuenta {color: n} válido (enteros 0..max) -> lista de colores repetidos, o un texto de error
function mix(k, max) {
  if (!k || typeof k !== 'object') return 'Elige cantidades.';
  const out = [];
  for (const c of C) { const n = has(k, c) ? k[c] : 0; if (!Number.isInteger(n) || n < 0 || n > max) return 'Cantidad no válida.'; for (let j = 0; j < n; j++) out.push(c); }
  return out;
}
const EFF = {
  quiet: r => { if (r.skipInf) return 'Ya está activa.'; r.skipInf = true; },
  // Se juega justo después de tirar los dados de la cura (antes de aceptar el resultado): el jugador elige qué dado relanza
  healthy: (r, d) => {
    if (!r.pc) return 'Solo se puede jugar justo después de tirar los dados de la cura, antes de aceptar el resultado.';
    if (!Number.isInteger(d.rd) || d.rd < 0 || d.rd >= r.pc.rs.length) return 'Elige el dado que quieres relanzar.';
    const old = r.pc.rs[d.rd]; r.pc.rs[d.rd] = roll(r.pc.c);
    log(r, 'Población sana: se relanza el dado ' + (d.rd + 1) + ' de la cura (' + old + ' → ' + r.pc.rs[d.rd] + ').');
  },
  // relanza un dado con biorriesgo del jugador activo ANTES de que se aplique
  attempt: (r, d) => {
    if (r.phase !== 'act') return 'Solo durante la fase de acciones, antes de aplicar el biorriesgo.';
    const cur = r.players[r.turn], x = Number.isInteger(d.i) ? cur.dice[d.i] : null;
    if (!x || !x.pend) return 'Elige un dado con biorriesgo que aún no se haya aplicado.';
    const y = newDie(cur); x.f = y.f; x.st = y.st; x.pend = y.pend; x.n = y.n; x.left = y.left;
    log(r, 'Intento de contención: el biorriesgo se relanza y sale ' + (y.pend ? 'otro biorriesgo.' : 'otra cara.'));
  },
  mobile: (r, d) => {
    const picks = [[d.reg, d.c], [d.reg2, d.c2]], t = r.reg.map(x => Object.assign({}, x));
    for (const [g, c] of picks) {
      if (!regOk(g) || !C.includes(c)) return 'Elige región y color para los dos dados.';
      if (!(t[g][c] > 0)) return 'No hay tantos dados de ese color ahí.';
      t[g][c]--;
    }
    picks.forEach(([g, c]) => { takeRegDie(r, g, c); addTreatDie(r, c, 'Movimiento de evento: un dado ' + NAME[c] + ' entra en el centro desde ' + REGIONS[g] + '.'); });
  },
  // Antes de tirar: fija las caras de los primeros dados. En la fase de acciones: cambia dados listos (nunca biorriesgos).
  plans: (r, d) => {
    const cur = r.players[r.turn], faces = ROLEFACES[cur.role].filter(f => f !== 'bio');
    const ch = Array.isArray(d.ch) ? d.ch.slice(0, 3) : [];
    if (!ch.length) return 'Elige al menos un dado.';
    if (ch.some(z => !z || !faces.includes(z.f))) return 'Cara no válida para este personaje.';
    if (r.phase === 'roll') { r.planned = ch.map(z => z.f); log(r, 'Cambio de planes: ' + ch.length + ' dado(s) saldrán con la cara elegida.'); return; }
    if (r.phase !== 'act') return 'Solo antes de tirar o durante la fase de acciones.';
    const seen = new Set();
    for (const z of ch) {
      const x = Number.isInteger(z.i) ? cur.dice[z.i] : null;
      if (!x || seen.has(z.i)) return 'Dado no válido.';
      if (x.st === 'bio') return 'No puedes cambiar un biorriesgo que ya ha salido.';
      if (x.st !== 'ready' || (x.n && x.left !== x.n)) return 'Solo se pueden cambiar dados sin usar.';
      seen.add(z.i);
    }
    ch.forEach(z => { cur.dice[z.i] = mkDie(z.f); });
    log(r, 'Cambio de planes: ' + ch.length + ' dado(s) cambian de cara.');
  },
  // se guarda; al infectar (o en una epidemia) se puede devolver un dado de los robados a la bolsa sin tirarlo
  supplies: r => { r.supply = (r.supply || 0) + 1; },
  community: (r, d, mine) => { r.comm = r.comm || []; if (r.comm.includes(mine.id)) return 'Ya está activa para ti.'; r.comm.push(mine.id); },
  coop: (r, d) => {
    const a = pl(r, d.from), b = pl(r, d.recv); if (!a || !b || a === b) return 'Elige dos jugadores distintos.';
    const k = d.k || {}, take = [];
    const cs = mix(k, 12); if (typeof cs === 'string') return cs; if (!cs.length) return 'Elige al menos una muestra.';
    for (const c of C) { const n = cs.filter(z => z === c).length; if (!n) continue; const mine = a.samples.filter(s => s.c === c); if (mine.length < n) return 'Ese jugador no tiene tantas muestras ' + NAME[c] + 's.'; take.push(...mine.slice(0, n)); }
    a.samples = a.samples.filter(s => !take.includes(s)); b.samples.push(...take);
  },
  disinfect: (r, d) => {
    const cs = mix(d.k, 4); if (typeof cs === 'string') return cs;
    if (cs.length > 4) return 'Elige entre 0 y 4 dados.';
    const t = r.treat.slice(); for (const c of cs) { const x = t.indexOf(c); if (x < 0) return 'No hay tantos dados ' + NAME[c] + 's en el centro.'; t.splice(x, 1); }
    r.treat = t; cs.forEach(c => r.bag.push(c));
  },
  extra: (r, d) => { const q = pl(r, d.who); if (!q) return 'Elige un jugador.'; if (!regOk(d.to)) return 'Elige una región.'; if (q.region === d.to) return 'Ya está en esa región.'; moveTo(r, q, d.to); }
};
function event(r, m) {
  const d = m.d || {}, id = d.id;
  if (!has(EVD, id)) return 'Carta no válida.';
  const E = EVD[id];
  const mine = r.local ? (m.pid === r.host ? r.players[r.turn] : null) : r.players.find(q => q.tok === m.pid);
  if (!mine) return 'No estás en la partida.';
  if (!r.evUp.includes(id)) return 'Esa carta no está disponible.';
  const have = cdcN(r); if (have < E.cost) return 'Hacen falta ' + E.cost + ' dado(s) en el CDC (hay ' + have + ').';
  const pe = payCheck(r, E.cost, d.pay); if (pe) return pe;
  const err = EFF[id](r, d, mine); if (err) return err;
  pay(r, d.pay);
  r.evUp.splice(r.evUp.indexOf(id), 1); r.evDeck.push(id); if (r.evDeck.length) r.evUp.push(r.evDeck.shift()); // el evento usado va al fondo del mazo
  log(r, 'EVENTO: ' + mine.name + ' juega «' + E.n + '».');
}
// ¿Tiene el dado alguna acción posible ahora? Si no, el jugador debe relanzarlo hasta que se pueda usar.
function canDo(r, p, f) {
  const here = C.some(c => r.reg[p.region][c] > 0);
  if (f === 'treat' || f === 'treat2' || f === 'treat3' || f === 'cross') return here || r.treat.length > 0;
  if (f === 'sample') return C.some(c => !r.cured[c] && r.treat.includes(c));
  if (f === 'contain') return r.treat.length > 0;
  if (f === 'heli') return !p.heli;
  return true;
}
function usable(r, p, x) { return x.st === 'ready' && x.f.split('|').some(f => canDo(r, p, f)); }
const pend = (r, p) => p.dice.filter(x => x.st === 'ready').length; // todos los dados listos son obligatorios
// pend = biorriesgo que aún no se ha aplicado (da margen para jugar «Intento de contención»)
function mkDie(f) { const x = { f, st: f === 'bio' ? 'bio' : 'ready' }; if (f === 'bio') x.pend = true; if (f === 'treat2') x.n = x.left = 2; if (f === 'treat3') x.n = x.left = 3; return x; }
function newDie(p) { return mkDie(ROLEFACES[p.role][rnd(6)]); }
// Aplica los biorriesgos pendientes uno a uno; se detiene si una epidemia queda en pausa (Suministros urgentes)
function runBio(r, p) {
  for (;;) {
    if (r.over || r.pi) return;
    const x = p.dice.find(z => z.pend); if (!x) return;
    x.pend = false; addBio(r, p);
  }
}
function endTurn(r) {
  r.shield = null; r.comm = []; r.cc = []; r.planned = null; r.cr = null;
  if (!r.over) { r.turn = (r.turn + 1) % r.players.length; r.phase = 'roll'; r.tried = false; r.players.forEach(q => q.dice = []); }
}
// Resultado de un intento de cura (rs = tirada de cada dado de muestra)
function finishCure(r, p, c, rs, bon) {
  const sum = rs.reduce((a, b) => a + b, 0) + bon;
  r.cr = { c, rs: rs.slice(), bon, sum, ok: sum >= 13 };
  log(r, p.name + ' intenta la cura ' + NAME[c] + ': [' + rs.join(',') + ']' + (bon ? ' +' + bon : '') + ' = ' + sum);
  if (sum >= 13) {
    r.cured[c] = true; let n = 0;
    // Regla de cura: todos los dados de este color que estén en muestras
    // de cualquier jugador vuelven a la bolsa, excepto uno que se conserva
    // como marcador de la cura, igual que en el juego de mesa.
    r.players.forEach(q => { const k = q.samples.filter(s => s.c === c).length; n += k; q.samples = q.samples.filter(s => s.c !== c); });
    for (let i = 0; i < Math.max(0, n - 1); i++) r.bag.push(c);
    const t = r.treat.filter(z => z === c).length; r.treat = r.treat.filter(z => z !== c); for (let i = 0; i < t; i++) r.bag.push(c);
    log(r, 'Cura ' + NAME[c] + ': vuelven a la bolsa ' + Math.max(0, n - 1) + ' dado(s) de muestras y ' + t + ' del centro de tratamiento. 1 dado queda como marcador de la cura.');
    r.fxSeq = (r.fxSeq || 0) + 1;
    r.fx = { seq: r.fxSeq, epidemic: false, outbreaks: [], cure: c };
    log(r, '¡CURA ' + NAME[c].toUpperCase() + ' ENCONTRADA!');
    if (C.every(z => r.cured[z])) { r.over = 'win'; log(r, '¡VICTORIA! Habéis salvado a la humanidad.'); }
  } else log(r, 'Fracaso. Se conservan las muestras.');
}
function addBio(r, p) { if (r.bioFree) { r.bioFree = false; log(r, p.name + ': el primer ☣ del turno no avanza la jeringa.'); } else addInf(r, 1); }
// Probabilidad exacta de sumar 13+ con n dados del color c (caras reales de cada color; la cara (+) vale 0)
function pcure(c, n, bon) {
  let dist = { 0: 1 };
  for (let i = 0; i < n; i++) { const nd = {}; FACES[c].forEach(f => { for (const s in dist) nd[+s + f] = (nd[+s + f] || 0) + dist[s] / 6; }); dist = nd; }
  let p = 0; for (const s in dist) if (+s + bon >= 13) p += dist[s]; return p;
}
function cureP(r) {
  const p = r.players[r.turn], o = {}; if (!p) return o;
  const bon = (p.role === 'geneticist' ? 2 : 0) + (r.bonus || 0);
  C.forEach(c => { const n = p.samples.filter(s => s.c === c).length; if (n && !r.cured[c]) o[c] = Math.round(pcure(c, n, bon) * 100); });
  return o;
}
function locked(r, id) { let n = 0; r.players.forEach(p => p.samples.forEach(s => { if (s.owner === id) n++; })); return n; }

function setup(r) {
  r.bag = []; C.forEach(c => { for (let i = 0; i < 12; i++) r.bag.push(c); });
  r.reg = Array.from({ length: 6 }, () => ({ blue: 0, yellow: 0, black: 0, red: 0 }));
  r.regd = Array.from({ length: 6 }, () => ({ blue: [], yellow: [], black: [], red: [] }));
  Object.assign(r, { treat: [], cdc: { blue: 0, yellow: 0, black: 0, red: 0 }, cured: {}, rate: 4 * (r.level | 0), out: 0, turn: 0, over: null, phase: 'roll', tried: false, started: true, log: [], skipInf: false, shield: null, bonus: 0, evDisc: [], cr: null, cc: [], pc: null, supply: 0, pi: null, planned: null, comm: [], fxSeq: 0, fx: null });
  draw(r, 12).forEach(c => { for (;;) { const f = roll(c); if (f !== 0 && r.reg[f - 1][c] < 3) { r.reg[f - 1][c]++; r.regd[f - 1][c].push(f); break; } } });
  const rl = shuffle(Object.keys(ROLES));
  r.players.forEach((p, i) => { p.id = i; p.region = 0; p.samples = []; p.dice = []; p.role = rl[i]; p.heli = false; });
  r.evDeck = shuffle(Object.keys(EVD)); r.evUp = r.evDeck.splice(0, 3);
  log(r, '¡Empieza la partida! Salvad a la humanidad.');
}
function pub(r) {
  return { code: r.code, started: r.started, local: r.local, players: r.players.map((p, i) => ({ id: i, name: p.name, region: p.region, role: p.role, heli: p.heli, dice: p.dice.map(x => Object.assign({}, x, { ok: usable(r, p, x) })), samples: p.samples })),
    regd: r.regd, bag: r.bag && r.bag.length, bagc: r.bag ? C.reduce((o, c) => (o[c] = r.bag.filter(z => z === c).length, o), {}) : null, reg: r.reg, treat: r.treat, cdc: r.cdc, cured: r.cured, rate: r.rate, hex: HEX, end: END, out: r.out, turn: r.turn, over: r.over, phase: r.phase, tried: r.tried, log: r.log, regions: REGIONS, roles: ROLES, evd: EVD, evUp: r.evUp, evDisc: r.evDisc, evLeft: r.evDeck && r.evDeck.length, skipInf: r.skipInf, pc: r.pc || null, cr: r.cr || null, cc: r.cc && r.cc[0] ? { who: r.cc[0].who, to: r.cc[0].to, n: C.reduce((o, c) => (r.reg[r.cc[0].to][c] > 0 && (o[c] = r.reg[r.cc[0].to][c]), o), {}) } : null, supply: r.supply || 0, pi: r.pi ? { dice: r.pi.dice, resume: r.pi.resume, rolled: !!r.pi.rolled } : null, planned: r.planned || null, comm: r.comm || [], faces: FACES, rfaces: ROLEFACES, cureP: r.started ? cureP(r) : {}, shield: r.shield, bonus: r.bonus, fx: r.fx || null, pend: r.started && r.players[r.turn] ? pend(r, r.players[r.turn]) : 0 };
}
const snap = (r, pid) => 'data:' + JSON.stringify(Object.assign(pub(r), { me: r.local ? r.turn : r.players.findIndex(p => p.tok === pid), host: pid === r.host })) + '\n\n';
function broadcast(r) { r.clients.forEach((pid, c) => c.write(snap(r, pid))); }

function heli(r, m) {
  const d = m.d || {}, q = pl(r, d.who);
  if (!q || !q.heli) return 'Ese jugador no tiene un Vuelo de emergencia.';
  if (r.local ? m.pid !== r.host : q.tok !== m.pid) return 'Ese vuelo no es tuyo.';
  if (!regOk(d.from) || !regOk(d.to) || d.from === d.to) return 'Elige dos regiones distintas.';
  const g = r.players.filter(z => z.region === d.from); if (!g.length) return 'No hay nadie en esa región.';
  g.forEach(z => moveTo(r, z, d.to)); q.heli = false;
  log(r, 'VUELO DE EMERGENCIA: ' + q.name + ' lleva a ' + g.map(z => z.name).join(', ') + ' de ' + REGIONS[d.from] + ' a ' + REGIONS[d.to] + '.');
}
function agive(r, m) {
  const d = m.d || {};
  const a = r.local ? (m.pid === r.host ? r.players.find(q => q.role === 'analyst') : null) : r.players.find(q => q.tok === m.pid);
  if (!a || a.role !== 'analyst') return 'Solo el ' + ROLES.analyst.n + ' puede hacerlo.';
  const b = pl(r, d.to); if (!b || b === a) return 'Elige a otro jugador.';
  const mine = a.samples.filter(s => s.c === d.c); if (!mine.length) return 'No tienes muestras de ese color.';
  a.samples = a.samples.filter(s => s.c !== d.c); b.samples.push(...mine);
  log(r, a.name + ' entrega ' + mine.length + ' muestra(s) ' + NAME[d.c] + ' a ' + b.name + '.');
}
function act(r, m, p) {
  const d = m.d || {};
  if (m.type === 'pinf') return resolvePi(r, p, d.c);
  if (m.type === 'pplace') return placePiDie(r, p, d.i, d.reg, !!d.cdc);
  if (r.pi) return 'Primero decide qué haces con la infección en curso (Suministros urgentes).';
  if (m.type === 'roll') {
    if (r.phase !== 'roll') return 'Ya has tirado.';
    let n = (p.role === 'generalist' ? 7 : 5) - locked(r, p.id);
    if (n <= 0) { for (const q of r.players) { const k = q.samples.findIndex(s => s.owner === p.id); if (k >= 0) { const c = q.samples.splice(k, 1)[0].c; addTreatDie(r, c, p.name + ' recupera una muestra ' + NAME[c] + ' para el centro.'); break; } } n = 1; }
    p.dice = []; r.phase = 'act'; r.bioFree = p.role === 'generalist';
    for (let i = 0; i < n; i++) p.dice.push(r.planned && i < r.planned.length ? mkDie(r.planned[i]) : newDie(p)); // Cambio de planes: caras elegidas
    r.planned = null;
    return;
  }
  if (m.type === 'cmove') { // Jefe de logística: mueve a otros peones de su región gratis
    if (p.role !== 'coordinator') return 'Solo el ' + ROLES.coordinator.n + ' puede hacerlo.';
    if (!regOk(d.to) || d.to === p.region) return 'Elige otra región.';
    const g = d.who === 'all' ? r.players.filter(z => z !== p && z.region === p.region) : [pl(r, d.who)].filter(z => z && z !== p && z.region === p.region);
    if (!g.length) return 'No hay otros peones en tu región.';
    g.forEach(z => moveTo(r, z, d.to)); log(r, p.name + ' mueve a ' + g.map(z => z.name).join(', ') + ' a ' + REGIONS[d.to] + '.');
    return;
  }
  if (r.phase === 'roll') return 'Primero tira los dados.';
  if (m.type === 'bio') {
    if (r.phase !== 'act') return 'La fase de acciones ya terminó.';
    if (!p.dice.some(x => x.pend)) return 'No hay biorriesgos pendientes.';
    runBio(r, p); return;
  }
  if (p.dice.some(x => x.pend)) return 'Aplica antes los biorriesgos (☣) de tus dados.';
  if (r.pc && m.type !== 'cureOK') return 'Acepta primero el resultado de la tirada de cura (o juega Población sana para relanzar un dado).';
  if ((m.type === 'next' && r.phase === 'act') || m.type === 'end') {
    const k = pend(r, p); if (k) return 'Debes usar todos tus dados antes de continuar (te quedan ' + k + '). Si alguno no se puede usar, relánzalo.';
  }
  if (m.type === 'next') { r.phase = r.phase === 'act' ? 'give' : 'cure'; return; }
  if ((m.type === 'reroll' || m.type === 'spend' || m.type === 'finish') && r.phase !== 'act') return 'La fase de acciones ya terminó.';
  if (m.type === 'give' && r.phase !== 'give') return 'Ahora no toca entregar muestras.';
  if (m.type === 'cure' && r.phase !== 'cure') return 'Ahora no toca buscar la cura.';
  if (m.type === 'finish') {
    const x = p.dice[d.i]; if (!x || x.st !== 'ready' || !x.n || x.left === x.n) return 'No se puede terminar ese dado.';
    x.st = 'spent';
  } else if (m.type === 'reroll') {
    (d.idx || []).forEach(i => { const x = p.dice[i]; if (x && x.st === 'ready' && (x.left === undefined || x.left === x.n)) { const y = newDie(p); x.f = y.f; x.n = y.n; x.left = y.left; x.st = y.st; x.pend = y.pend; } });
  } else if (m.type === 'spend') {
    const x = p.dice[d.i]; if (!x || x.st !== 'ready') return 'Dado no disponible.';
    const opts = x.f.split('|'), f = opts.length > 1 ? d.as : x.f; if (!opts.includes(f)) return 'Elige qué acción hacer con este dado.';
    if (f === 'fly') { if (!regOk(d.to) || d.to === p.region) return 'Región no válida.'; moveTo(r, p, d.to); }
    else if (f === 'sail') { const df = (d.to - p.region + 6) % 6; if (!regOk(d.to) || (df !== 1 && df !== 5)) return 'Solo regiones contiguas.'; moveTo(r, p, d.to); }
    else if (f === 'treat' || f === 'treat2' || f === 'treat3') {
      const c = d.c; if (!C.includes(c)) return 'Color no válido.';
      if (d.mode === 'region') {
        if (!r.reg[p.region][c]) return 'No hay de ese color aquí.';
        takeRegDie(r, p.region, c); // siempre un solo dado por acción
        addTreatDie(r, c, p.name + ' trata ' + NAME[c] + ' en ' + REGIONS[p.region] + '.');
      } else {
        if (!r.treat.includes(c)) return 'No hay de ese color en el centro.';
        r.treat.splice(r.treat.indexOf(c), 1); r.bag.push(c); // un solo dado por acción de tratar, va a la bolsa
        if (r.cured[c]) log(r, p.name + ' trata ' + NAME[c] + ' del centro (cura encontrada): 1 dado va a la bolsa.');
      }
      if (x.left) { x.left--; if (x.left > 0) return; } // dado de 2/3 acciones: sigue listo hasta gastarlas
    } else if (f === 'sample') {
      const c = d.c; if (r.cured[c] || !r.treat.includes(c)) return 'No se puede tomar muestra de eso.';
      r.treat.splice(r.treat.indexOf(c), 1); p.samples.push({ c, owner: p.id });
    } else if (f === 'cross') {
      const c = d.c; if (!C.includes(c)) return 'Color no válido.';
      if (d.mode === 'region') { if (!r.reg[p.region][c]) return 'No hay de ese color aquí.'; takeRegDie(r, p.region, c); }
      else { const k = r.treat.indexOf(c); if (k < 0) return 'No hay de ese color en el centro.'; r.treat.splice(k, 1); }
      r.cdc[c]++; log(r, p.name + ' cambia un dado ' + NAME[c] + ' por la cara (+): va al CDC.');
    } else if (f === 'contain') {
      const cs = Array.isArray(d.cs) ? d.cs.slice(0, 3) : []; if (!cs.length) return 'Elige al menos un dado.';
      const tmp = r.treat.slice(); for (const c of cs) { const k = tmp.indexOf(c); if (k < 0) return 'No hay tantos dados de ese color en el centro.'; tmp.splice(k, 1); }
      r.treat = tmp; cs.forEach(c => r.bag.push(c)); log(r, p.name + ' devuelve ' + cs.length + ' dado(s) del centro a la bolsa.');
    } else if (f === 'heli') {
      if (p.heli) return 'Ya tienes un Vuelo de emergencia guardado.'; p.heli = true; log(r, p.name + ' guarda un Vuelo de emergencia.');
    } else return 'Ese dado no se gasta así.';
    x.st = 'spent';
  } else if (m.type === 'give') {
    const q = r.players[d.to]; if (!q || q === p || q.region !== p.region) return 'Debe estar en tu región.';
    const mine = p.samples.filter(s => s.c === d.c); if (!mine.length) return 'No tienes muestras de ese color.';
    p.samples = p.samples.filter(s => s.c !== d.c); q.samples.push(...mine);
  } else if (m.type === 'cure') {
    const c = d.c, mine = p.samples.filter(s => s.c === c);
    if (r.tried) return 'Solo un intento por turno.'; if (!mine.length) return 'Sin muestras de ese color.';
    r.tried = true; const rs = mine.map(() => roll(c)), bon = (p.role === 'geneticist' ? 2 : 0) + (r.bonus || 0); r.bonus = 0;
    r.pc = { c, rs, bon }; log(r, p.name + ' lanza los dados de cura ' + NAME[c] + ': [' + rs.join(', ') + ']' + (bon ? ' +' + bon : '') + '.');
    // Si nadie puede jugar Población sana ahora, el resultado se resuelve al momento
    if (!(r.evUp.includes('healthy') && cdcN(r) >= EVD.healthy.cost)) { const pc = r.pc; r.pc = null; finishCure(r, p, pc.c, pc.rs, pc.bon); }
  } else if (m.type === 'cureOK') { // aceptar el resultado de la tirada de cura
    if (!r.pc) return 'No hay una tirada de cura pendiente.';
    const pc = r.pc; r.pc = null; finishCure(r, p, pc.c, pc.rs, pc.bon);
  } else if (m.type === 'end') {
    if (r.skipInf) {
      r.skipInf = false;
      log(r, 'Noche tranquila: esta vez no se infecta.');
      endTurn(r);
    } else {
      infect(r, draw(r, HEX[r.rate >> 2]), 'end');
      // MUY IMPORTANTE: si la infección quedó pendiente para colocación manual,
      // NO termina el turno todavía. finishPiPlacement() lo hará cuando todos
      // los dados hayan sido colocados.
      if (!r.pi) endTurn(r);
    }
  }
}

function handle(r, m) {
  if (m.type === 'start') { if (m.pid !== r.host) return 'Solo el anfitrión empieza.'; r.level = Math.min(2, Math.max(0, (m.d && m.d.level) | 0)); setup(r); return; }
  if (!r.started || r.over) return 'La partida no está en curso.';
  if (r.cc && r.cc.length && m.type !== 'ccpick') return 'Primero elige qué dado llevas al centro (Apoyo de la comunidad).';
  if (m.type === 'ccpick') {
    const h = r.cc && r.cc[0]; if (!h) return 'No hay ninguna elección pendiente.';
    const o = r.players[h.who], cu = r.players[r.turn];
    if (!(r.local ? m.pid === r.host : (o.tok === m.pid || cu.tok === m.pid))) return 'Esta elección no es tuya.';
    return resolveCc(r, (m.d || {}).c);
  }
  if (m.type === 'event') return event(r, m);
  if (m.type === 'heli') return heli(r, m);
  if (m.type === 'agive') return agive(r, m);
  const cur = r.players[r.turn];
  const p = r.local ? (m.pid === r.host ? cur : null) : (cur.tok === m.pid ? cur : null);
  if (!p) return 'No es tu turno.';
  return act(r, m, p);
}

const body = req => new Promise(ok => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } }); });
const tok = () => Math.random().toString(36).slice(2);
const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/events') {
    const r = rooms[u.searchParams.get('room')]; if (!r) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const pid = u.searchParams.get('pid'); r.clients.set(res, pid); res.write(snap(r, pid));
    return req.on('close', () => r.clients.delete(res));
  }
  if (u.pathname === '/api' && req.method === 'POST') {
    const m = await body(req), name = String(m.name || 'Jugador').slice(0, 14);
    if (m.type === 'create' || m.type === 'local') {
      let code; do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[rnd(32)]).join(''); } while (rooms[code]);
      const host = tok(), n = m.type === 'local' ? Math.min(5, Math.max(1, m.n | 0)) : 1;
      const r = rooms[code] = { code, host, local: m.type === 'local', clients: new Map(), started: false, log: [], players: [] };
      for (let i = 0; i < n; i++) r.players.push({ name: m.type === 'local' && i ? 'Jugador ' + (i + 1) : name, tok: i ? tok() : host, region: 0, samples: [], dice: [] });
      if (r.local) { r.level = Math.min(2, Math.max(0, m.level | 0)); setup(r); }
      return json(res, { room: code, pid: host });
    }
    const r = rooms[String(m.room || '').toUpperCase()];
    if (m.type === 'join') {
      if (!r) return json(res, { error: 'Esa sala no existe.' });
      if (r.started || r.players.length >= 5) return json(res, { error: 'Sala llena o ya empezada.' });
      const t = tok(); r.players.push({ name, tok: t, region: 0, samples: [], dice: [] }); broadcast(r);
      return json(res, { room: r.code, pid: t });
    }
    if (!r) return json(res, { error: 'Sala no encontrada.' });
    let err; try { err = handle(r, m); } catch (e) { console.error('Error en la acción', m.type, e); err = 'Error interno del servidor en «' + m.type + '»: ' + e.message; }
    broadcast(r); return json(res, err ? { error: err } : { ok: 1 });
  }
  // Servir también los recursos estáticos de /public (fondos, imágenes, etc.).
  // Antes cualquier petición como /fondo-pandemic-real.png acababa devolviendo index.html,
  // por eso el navegador no podía pintar el fondo.
  const clean = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const publicRoot = path.resolve(__dirname, 'public');
  const filePath = path.resolve(publicRoot, clean || 'index.html');
  if (filePath.startsWith(publicRoot + path.sep)) {
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    }[path.extname(filePath).toLowerCase()];
    if (mime) {
      return fs.readFile(filePath, (e, b) => {
        if (e) {
          res.writeHead(e.code === 'ENOENT' ? 404 : 500);
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
        res.end(b);
      });
    }
  }
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, b) => { res.writeHead(e ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); });
}).listen(process.env.PORT || 3000, () => console.log('Pandemic: La cura en http://localhost:' + (process.env.PORT || 3000)));
