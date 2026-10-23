/* Probe headless do mw-tab-air-card — monta card e editor fora do navegador
 * com o mesmo shim de DOM dos irmãos. Pega o que dói perder sem abrir o HA:
 * os dois modos de comando (cenas e MW Infrared), o `show_when` pelo estado da
 * tomada, a descoberta dos sensores de energia em Tuya/Tapo e o editor
 * montando sem `hass` e sem os elementos internos do HA.
 *
 * Roda no CI e antes de qualquer PR:  node tools/probe.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ------------------------------- shim DOM ------------------------------- */

const mkStyle = () => {
  const s = { _p: {} };
  s.setProperty = (k, v) => { s._p[k] = String(v); };
  s.removeProperty = (k) => { delete s._p[k]; };
  s.get = (k) => s._p[k];
  return s;
};

class Node {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.style = mkStyle();
    this.children = [];
    this.dataset = {};
    this._attrs = {};
    this._listeners = {};
    this._q = new Map();
    this._classes = new Set();
    this.innerHTML = "";
    this.textContent = "";
    this.hidden = false;
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
      toggle: (c, on) => (on === undefined
        ? (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c))
        : (on ? this._classes.add(c) : this._classes.delete(c))),
    };
  }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  append(...n) { n.forEach((x) => this.appendChild(x)); }
  insertBefore(n, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  replaceChild(nw, old) {
    const i = this.children.indexOf(old);
    if (i >= 0) this.children[i] = nw;
    nw.parentNode = this;
  }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  removeEventListener() {}
  dispatchEvent(ev) { (this._listeners[ev && ev.type] || []).forEach((f) => f(ev)); return true; }
  // memoiza por seletor: o código só consulta seletores fixos
  querySelector(sel) {
    if (!this._q.has(sel)) this._q.set(sel, new Node("div"));
    return this._q.get(sel);
  }
  querySelectorAll() { return []; }
  getElementById(id) { return this.querySelector("#" + id); }
  focus() {}
}

global.Node = Node;
global.HTMLElement = class extends Node {
  attachShadow() { this.shadowRoot = new Node("shadow-root"); return this.shadowRoot; }
};
global.CustomEvent = class {
  constructor(type, init) { this.type = type; Object.assign(this, init || {}); }
};
const reg = {};
global.customElements = {
  define: (n, c) => { reg[n] = c; },
  get: (n) => reg[n],
  whenDefined: () => Promise.resolve(),
};
global.document = { createElement: (t) => new Node(t), body: new Node("body") };
// no Node 24 `navigator` é getter-only: define por cima, não por atribuição
Object.defineProperty(global, "navigator", { value: { vibrate: () => {} }, configurable: true });

// helpers de bolso: os "cards de dentro" viram nós marcados
global.window = {
  customCards: [],
  localStorage: { _v: {}, getItem(k) { return k in this._v ? this._v[k] : null; }, setItem(k, v) { this._v[k] = v; } },
  dispatchEvent: () => {},
  loadCardHelpers: async () => ({
    createCardElement(cfg) {
      const el = new Node("div");
      el._cfg = cfg;
      el.getCardSize = () => 2;
      return el;
    },
  }),
};

const CARD_FILE = "mw-tab-air-card.js";
const CARD_TYPE = "mw-tab-air-card";
const BANNER = "MW-TAB-AIR-CARD";
const TAB_LABEL = "AR-CONDICIONADO";
const TAB_ICON = "mdi:air-conditioner";
const HEADING = "❄️ AR-CONDICIONADO";
const POWER_NAME = "TOMADA AR";
const SHELL = "rgba(68, 68, 68, 1)";
const IMG = "/local/devices/ar-britania-rab.webp";
const SOCKET = "switch.tomada_ar_escritorio";
const SOCKET_V = "sensor.tomada_ar_escritorio_voltagem";
const SOCKET_C = "sensor.tomada_ar_escritorio_corrente";
const SOCKET_P = "sensor.tomada_ar_escritorio_potencia";
const SCENES = [
  ["scene.ar_escritorio", "AR Escritório"],
  ["scene.ligar_ar_escritorio", "Ligar AR"],
  ["scene.desligar_ar_escritorio", "Desligar AR"],
  ["scene.reduzir_o_ar_do_escritorio", "Reduzir AR"],
  ["scene.aumentar_o_ar_do_escritorio", "Aumentar AR"],
];
const SCENE_MAP = {
  prepare: "scene.ar_escritorio", on: "scene.ligar_ar_escritorio",
  off: "scene.desligar_ar_escritorio", down: "scene.reduzir_o_ar_do_escritorio",
  up: "scene.aumentar_o_ar_do_escritorio",
};
const SLOT_KEYS = ["prepare", "on", "off", "down", "up"];
const SLOT_ICONS = ["mdi:fan-clock", "mdi:play", "mdi:stop", "mdi:thermometer-minus", "mdi:thermometer-plus"];
const SLOT_WHEN = ["off", "off", "on", "on", "on"];

const infoBanner = [];
const realInfo = console.info;
console.info = (...a) => infoBanner.push(a.join(" "));

const SRC = path.join(__dirname, "..", "dist", CARD_FILE);
eval(fs.readFileSync(SRC, "utf8"));
console.info = realInfo;

let pass = 0; const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${msg} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

/* ------------------------------- hass falso ------------------------------ */

const TUYA = "tomada-tuya";
const TAPO = "tomada-tapo";
const IRDEV = "controle-ir-escritorio";
const HASS = {
  areas: { escritorio: { name: "Escritório" } },
  devices: { [TUYA]: { name: "Tomada AR" }, [TAPO]: { name: "Tomada Tapo" },
             [IRDEV]: { name: "⬛️❄️ AR DO ESCRITÓRIO" }, clima1: { name: "Sensor Sala" } },
  entities: {}, states: {}, callService() {},
};
const add = (id, dev, nome, extra) => {
  HASS.entities[id] = Object.assign({ device_id: dev }, extra || {});
  HASS.states[id] = { state: "off", attributes: { friendly_name: nome } };
};
for (const [id, nome] of SCENES) add(id, null, nome);
// tomada Tuya, em português
add(SOCKET, TUYA, "Tomada AR Escritório");
add(SOCKET_V, TUYA, "Voltagem");
add(SOCKET_C, TUYA, "Corrente");
add(SOCKET_P, TUYA, "Potência");
// tomada Tapo, em inglês e com energia acumulada para confundir
add("switch.tapo_ar", TAPO, "Tapo AR");
add("sensor.tapo_ar_today_energy", TAPO, "Today Energy");
add("sensor.tapo_ar_current_power", TAPO, "Current Power");
// controle IR do MW Infrared
add("button.ar_do_escritorio_power_on", IRDEV, "Power On");
add("button.ar_do_escritorio_power_off", IRDEV, "Power Off");
add("button.ar_do_escritorio_temp_up", IRDEV, "Temp Up");
add("button.ar_do_escritorio_temp_down", IRDEV, "Temp Down");
add("button.ar_do_escritorio_fan", IRDEV, "Fan");

const mk = (cfg) => {
  const el = new (customElements.get(CARD_TYPE))();
  el.isConnected = true;
  el.setConfig(cfg);
  el.hass = HASS;
  return el;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

ok(!!customElements.get(CARD_TYPE), "custom element não registrado");
ok(!!customElements.get(CARD_TYPE + "-editor"), "editor não registrado");

(async () => {
  const card = mk({
    power_entity: SOCKET, socket_device: TUYA,
    image: IMG,
    rainbow_devices: [{ device: "clima1" }],
    scenes: SCENE_MAP,
  });
  await tick(); await tick(); await tick();
  const cfg = card._child && card._child._cfg;
  ok(!!cfg, "o card não montou o custom:mw-tab-card");
  if (cfg) {
    eq(cfg.type, "custom:mw-tab-card", "tipo do filho");
    eq(cfg.paper_color, "orange-7", "papel padrão");
    eq(cfg.shell_color, SHELL, "casca padrão");
    eq(cfg.tab_position, "right", "abas à direita");
    eq(cfg.tabs.length, 2, "duas abas");
    eq(cfg.tabs[0].label, TAB_LABEL, "rótulo da 1ª aba");
    eq(cfg.tabs[0].icon, TAB_ICON, "ícone da 1ª aba");

    const c = cfg.tabs[0].cards;
    eq(c[0].type, "custom:mw-rainbow-card", "arco-íris no topo");
    eq(c[0].bands, [{ metric: "temperature" }], "faixa de temperatura");
    eq(c[0].grid_options, { columns: "full" }, "arco-íris ocupa a largura");
    eq(c[1].cards[0], { type: "picture", image: IMG }, "a foto");
    const fileira = c[1].cards[1].cards[2];
    eq(fileira.type, "custom:mw-scene-button-card", "fileira de botões");
    eq(fileira.button_columns, 2, "duas colunas de botões");
    eq(fileira.hide_label, true, "botões sem rótulo");
    eq(fileira.icon_size, "65%", "ícone a 65%");
    eq(fileira.buttons.length, SLOT_KEYS.length, "um botão por papel preenchido");
    eq(fileira.buttons.map((b) => b.entity), SLOT_KEYS.map((k) => SCENE_MAP[k]), "ordem dos papéis");
    eq(fileira.buttons.map((b) => b.icon), SLOT_ICONS, "ícones do desenho");
    eq(fileira.buttons.map((b) => b.show_when.state), SLOT_WHEN, "quem aparece com a tomada ligada/desligada");
    eq(fileira.buttons.every((b) => b.show_when.entity === SOCKET), true, "show_when aponta para a tomada");
    eq(c[2], { type: "heading", heading: HEADING, heading_style: "title" }, "título da aba");

    const e = cfg.tabs[1].cards;
    eq(e[0].heading, "🔌 TOMADAS ELÉTRICAS", "título da aba de energia");
    ok(e[1].card_mod && /align-content: start/.test(e[1].card_mod.style), "tomada presa no topo");
    const pw = e[1].cards[0];
    eq(pw.type, "custom:power-button-card", "card da tomada");
    eq(pw.entity, SOCKET, "interruptor da tomada");
    eq(pw.name, POWER_NAME, "nome da tomada");
    eq(pw.sensor_voltagem, SOCKET_V, "sensor de tensão achado");
    eq(pw.sensor_corrente, SOCKET_C, "sensor de corrente achado");
    eq(pw.sensor_potencia, SOCKET_P, "sensor de potência achado");
  }

  // Tapo: inglês, sem tensão/corrente, e energia acumulada NÃO é potência
  const c2 = mk({ power_entity: "switch.tapo_ar", scenes: SCENE_MAP });
  await tick(); await tick(); await tick();
  const cfg2 = c2._child && c2._child._cfg;
  if (cfg2) {
    const pw = cfg2.tabs[1].cards[1].cards[0];
    eq(pw.sensor_potencia, "sensor.tapo_ar_current_power", "potência do Tapo");
    ok(!pw.sensor_voltagem, "Tapo não tem tensão — não pode inventar");
    ok(!/energy/.test(String(pw.sensor_potencia)), "energia acumulada entrou como potência");
  }

  // modo infravermelho: as teclas do MW Infrared viram os botões
  const c3 = mk({ control: "infrared", ir_device: IRDEV, power_entity: SOCKET, socket_device: TUYA });
  await tick(); await tick(); await tick();
  const cfg3 = c3._child && c3._child._cfg;
  if (cfg3) {
    const fileira = cfg3.tabs[0].cards[0].cards[2];
    eq(fileira.type, "custom:mw-scene-button-card", "fileira também no modo IR");
    const ents = fileira.buttons.map((b) => b.entity);
    ok(ents.includes("button.ar_do_escritorio_power_on"), "tecla de ligar não foi achada");
    ok(ents.includes("button.ar_do_escritorio_power_off"), "tecla de desligar não foi achada");
    ok(ents.includes("button.ar_do_escritorio_temp_up"), "tecla de subir não foi achada");
    ok(ents.includes("button.ar_do_escritorio_temp_down"), "tecla de baixar não foi achada");
    ok(ents.every((e) => e.indexOf("button.") === 0), "só teclas button.* no modo IR");
  }

  // sem tomada: nada de show_when e nada de aba de energia
  const c4 = mk({ scenes: SCENE_MAP });
  await tick(); await tick(); await tick();
  const cfg4 = c4._child && c4._child._cfg;
  if (cfg4) {
    eq(cfg4.tabs.length, 1, "sem tomada não há aba de energia");
    const fileira = cfg4.tabs[0].cards[0].cards[2];
    ok(fileira.buttons.every((b) => !b.show_when), "sem tomada não pode esconder botão");
  }

  // override de aparência por papel + yaml_override
  const c5 = mk({ scenes: SCENE_MAP, power_entity: SOCKET,
    button_overrides: { [SLOT_KEYS[0]]: { icon: "mdi:rocket", name: "TESTE" } },
    yaml_override: { shell_color: "#123456" } });
  await tick(); await tick(); await tick();
  const cfg5 = c5._child && c5._child._cfg;
  if (cfg5) {
    eq(cfg5.shell_color, "#123456", "override da casca");
    const b0 = cfg5.tabs[0].cards[0].cards[2].buttons[0];
    eq(b0.icon, "mdi:rocket", "ícone trocado pelo override");
    eq(b0.name, "TESTE", "nome trocado pelo override");
  }

  // sem cena nenhuma: aviso honesto dentro do painel, não tela quebrada
  const c6 = mk({});
  await tick(); await tick(); await tick();
  const cfg6 = c6._child && c6._child._cfg;
  if (cfg6) {
    const dentro = cfg6.tabs[0].cards[0].cards[2];
    eq(dentro.type, "markdown", "faltou o aviso de que não há botão");
  }

  // editor monta sem hass e sem os elementos internos do HA
  const ed = new (customElements.get(CARD_TYPE + "-editor"))();
  let erro = null;
  try { ed.setConfig({ scenes: SCENE_MAP }); } catch (e) { erro = e; }
  ok(!erro, `editor quebrou sem hass: ${erro && erro.message}`);
  erro = null;
  try { ed.hass = HASS; } catch (e) { erro = e; }
  ok(!erro, `editor quebrou com hass: ${erro && erro.message}`);

  const emitido = [];
  ed.addEventListener("config-changed", (ev) => emitido.push(ev.detail.config));
  ed._patch({ spacers: 2, paper_color: "orange-7" });
  const last = emitido[emitido.length - 1] || {};
  ok(!("spacers" in last), "spacers igual ao default foi escrito no YAML");
  ok(!("paper_color" in last), "paper_color igual ao default foi escrito no YAML");

  ok(infoBanner.some((l) => new RegExp(BANNER).test(l)), "banner de versão ausente");

  if (fails.length) {
    console.error(`\n✗ probe: ${fails.length} falha(s), ${pass} ok\n`);
    for (const f of fails) console.error("  · " + f);
    process.exit(1);
  }
  console.log(`✓ probe ${CARD_TYPE}: ${pass} verificações passaram`);
})();
