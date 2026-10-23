/* mw-ha-tab-air-card — custom:mw-tab-air-card
 * A tela inteira de um ar-condicionado em abas, a partir de duas chaves: como
 * ele é comandado e qual tomada o alimenta.
 *   aba AR-CONDICIONADO → faixa de temperatura da casa (mw-rainbow-card) +
 *        foto + a fileira de botões de papel (mw-scene-button-card)
 *   aba ENERGIA         → a tomada em custom:power-button-card, com os
 *        sensores de tensão/corrente/potência achados sozinhos (Tuya,
 *        LocalTuya, Tapo ou escolha manual)
 *
 * Dois modos de comando, como no ventilador de teto:
 *   · `control: scenes`   — cenas do HA (o caminho da casa hoje)
 *   · `control: infrared` — as teclas do MW Infrared Controller, que são
 *     entidades `button.*` do controle pareado
 * O botão que aparece depende do estado da tomada (`show_when`): apagado
 * mostra PREPARAR e LIGAR; aceso mostra DESLIGAR, MENOS e MAIS.
 *
 * Nada é redesenhado aqui: este card é o COMPOSITOR — irmão do
 * mw-ha-tab-lights-card e do mw-ha-tab-humidifier-card.
 *
 * Sem build, sem dependências de bundler: JS puro + <ha-form> do HA.
 * Repo: https://github.com/visaodeempresa/mw-ha-tab-air-card
 */
(() => {
  "use strict";

  const VERSION = "0.1.0";
  /* ------------------------------------------------------------ utilidades */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  /** merge profundo; array substitui (lista é decisão, não acúmulo). */
  const deepMerge = (base, over) => {
    if (!isObj(over)) return over === undefined ? base : over;
    const out = { ...(isObj(base) ? base : {}) };
    for (const [k, v] of Object.entries(over)) {
      if (v === null) { delete out[k]; continue; }
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
    }
    return out;
  };

  /** tira vazio: default intacto não polui o YAML (regra da família). */
  const clean = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) {
      if (v === undefined || v === null || v === "") continue;
      out[k] = v;
    }
    return out;
  };

  /** o que MUDOU de `base` para `next` — é isso que vira override no YAML. */
  const diffObj = (base, next) => {
    const out = {};
    for (const [k, v] of Object.entries(next || {})) {
      if (JSON.stringify(base ? base[k] : undefined) !== JSON.stringify(v)) out[k] = v;
    }
    return out;
  };

  const sig = (v) => { try { return JSON.stringify(v); } catch (_) { return String(v); } };

  // >>> paper-palette v1 — fonte canônica: /Volumes/SSD-T1-01/CLAUDE-SSD/IA/lib/paper-palette/paper-palette.js
  // 49 papéis encardidos: 7 matizes do arco-íris × 7 tons (1 = quase branco,
  // 7 = mais encardido). Saturação baixa de propósito — papel descansa a vista.
  const PAPER_HUES = [
    ["red", "Vermelho", 6], ["orange", "Laranja", 27], ["yellow", "Amarelo", 47],
    ["green", "Verde", 96], ["blue", "Azul", 203], ["indigo", "Anil", 236],
    ["violet", "Violeta", 283],
  ];
  const PAPER_TONES = [[97, 6], [96, 9], [94, 12], [92, 15], [90, 18], [88, 21], [85, 24]];
  const paperOptions = () => [{ value: "paper", label: "Papel original (creme)" }].concat(
    ...PAPER_HUES.map((h) => PAPER_TONES.map((t, i) => ({
      value: `${h[0]}-${i + 1}`,
      label: `${h[1]} · tom ${i + 1}${i === 0 ? " (mais claro)" : i === 6 ? " (mais encardido)" : ""}`,
    }))));
  // <<< paper-palette v1

  // >>> paper-dark-palette v1 — fonte canônica: IA/lib/paper-palette/paper-dark-palette.js
  const PAPER_DARK_TONES = [[26, 10], [24, 13], [21, 16], [19, 19], [16, 22], [14, 25], [11, 28]];
  const paperDarkOptions = () => [{ value: "paper", label: "Papel de noite (grafite)" }].concat(
    ...PAPER_HUES.map((h) => PAPER_DARK_TONES.map((t, i) => ({
      value: `${h[0]}-${i + 1}`,
      label: `${h[1]} · tom ${i + 1}${i === 0 ? " (mais claro)" : i === 6 ? " (mais escuro)" : ""}`,
    }))));
  // <<< paper-dark-palette v1

  // ---- cor: parse / compose (mantém alfa, que o desenho usa muito) ----
  const parseColor = (str) => {
    const s = String(str || "").trim();
    let m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
    m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) { const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16)); return { r, g, b, a: 1 }; }
    return { r: 128, g: 128, b: 128, a: 1 };
  };
  const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const toRgba = ({ r, g, b, a }) => `rgba(${r}, ${g}, ${b}, ${a})`;


  /* ------------------------------------------------------------- defaults */

  const DEFAULTS = {
    control: "scenes",          // scenes | infrared
    power_entity: "",           // a tomada: é o estado dela que troca os botões
    socket_device: "",          // dispositivo da tomada (Tuya, LocalTuya, Tapo…)
    ir_device: "",              // controle pareado do MW Infrared (modo infrared)
    image: "",
    rainbow: true,
    energy_tab: true,
    spacers: 2,
    button_columns: 2,
    icon_size: "65%",
    paper_color: "orange-7",
    shell_color: "rgba(68, 68, 68, 1)",
    heading: "❄️ AR-CONDICIONADO",
    energy_heading: "🔌 TOMADAS ELÉTRICAS",
  };

  const TABS_DEFAULTS = {
    tab_display: "icon",
    tab_icon_size: 32,
    tab_position: "right",
    keep_alive: false,
  };

  const AIR_TAB = { label: "AR-CONDICIONADO", icon: "mdi:air-conditioner" };
  const ENERGY_TAB = { label: "ENERGIA", icon: "mdi:flash" };

  // A faixa do topo aqui é TEMPERATURA (no umidificador é umidade): é o que o
  // olho procura antes de decidir ligar o ar.
  const RAINBOW_DEFAULTS = {
    bands: [{ metric: "temperature" }],
    section_labels: "none",
    band_labels: "none",
    name_size: 17,
    grid_options: { columns: "full" },
  };

  const POWER_DEFAULTS = {
    name: "TOMADA AR",
    device_icon: "mdi:flash",
    protocol_icon: "mdi:wifi",
    background_image_url: "/local/devices/ha-integration-tuya.png",
    confirm: true,
    only_power: true,
    power_font_size: 20,
    only_power_lift: 3,
  };

  // A grade da aba de energia com UM card sozinho estica o botão para a altura
  // inteira do painel. `align-content:start` prende no topo — é o que o YAML
  // escrito à mão fazia com card_mod, e continua sendo a saída honesta.
  const ENERGY_MOD = { style: "div {\n  align-content: start;\n}\n" };

  /* ------------------------------- os cinco botões ------------------------ */

  // A fileira do desenho: dois botões com o ar desligado (preparar e ligar) e
  // três com ele ligado (desligar, menos, mais). `when` é o estado da TOMADA.
  const SLOTS = [
    { key: "prepare", icon: "mdi:fan-clock", name: "AR", ink: "rgba(28, 25, 20, 0.92)", when: "off" },
    { key: "on", icon: "mdi:play", name: "AR", paper: "green-6", ink: "rgba(22, 58, 26, 0.92)", when: "off" },
    { key: "off", icon: "mdi:stop", name: "DESLIG.", paper: "red-6", ink: "rgba(120, 20, 28, 0.95)",
      name_ink: "rgba(176, 0, 32, 0.95)", when: "on" },
    { key: "down", icon: "mdi:thermometer-minus", name: "MENOS", paper: "green-6", ink: "rgba(22, 58, 26, 0.92)", when: "on" },
    { key: "up", icon: "mdi:thermometer-plus", name: "MAIS", paper: "green-6", ink: "rgba(22, 58, 26, 0.92)", when: "on" },
  ];
  const SLOT_LABEL = {
    prepare: "Preparar (ventilar antes)", on: "Ligar", off: "Desligar",
    down: "Baixar a temperatura", up: "Subir a temperatura",
  };

  /* -------------------------------- descoberta ------------------------------ */

  const entitiesOfDevice = (hass, dev) => {
    if (!hass || !hass.entities || !dev) return [];
    return Object.keys(hass.entities).filter((id) => {
      const e = hass.entities[id];
      return e && e.device_id === dev && !e.hidden_by && !e.disabled_by;
    });
  };

  const friendly = (hass, id) => {
    const st = hass && hass.states && hass.states[id];
    return (st && st.attributes && st.attributes.friendly_name) || id;
  };

  const deviceName = (hass, dev) => {
    const d = hass && hass.devices && hass.devices[dev];
    return (d && (d.name_by_user || d.name)) || dev || "—";
  };

  const rotulo = (hass, id) => `${friendly(hass, id)} ${id}`.toLowerCase();

  // As teclas do MW Infrared: uma entidade `button.*` por tecla do controle
  // pareado. O nome da tecla varia com o fabricante, então cada papel tem uma
  // lista de sinônimos — e o que não casar fica para o dono escolher à mão.
  const IR_MATCH = {
    on: [/power[_ ]?on|ligar|turn[_ ]?on|\bon\b/, /power|liga/],
    off: [/power[_ ]?off|desligar|turn[_ ]?off|\boff\b/],
    up: [/temp[_ ]?(up|\+)|aumentar|subir|warmer|up\b/],
    down: [/temp[_ ]?(down|-)|reduzir|diminuir|baixar|cooler|down\b/],
    prepare: [/fan|vent|swing|mode|modo/],
  };

  const irButtons = (hass, dev) => entitiesOfDevice(hass, dev).filter((id) => id.indexOf("button.") === 0);

  const guessIr = (hass, dev) => {
    const ids = irButtons(hass, dev);
    const usados = new Set();
    const out = {};
    for (const [slot, regras] of Object.entries(IR_MATCH)) {
      for (const re of regras) {
        const achou = ids.find((id) => !usados.has(id) && re.test(rotulo(hass, id)));
        if (achou) { out[slot] = achou; usados.add(achou); break; }
      }
    }
    return out;
  };

  /** a tomada: entidade explícita › switch do dispositivo da tomada. */
  const socketEntity = (hass, cfg) => {
    if (cfg.power_entity) return cfg.power_entity;
    const sws = entitiesOfDevice(hass, cfg.socket_device).filter((id) => id.indexOf("switch.") === 0);
    return sws.find((id) => /socket|tomada|plug/.test(id)) || sws[0] || "";
  };

  // Tuya fala português ("voltagem", "corrente", "potência"); Tapo e o resto do
  // mundo falam inglês ("voltage", "current", "current_power"). Energia
  // acumulada (kWh, "today_energy", "consumo") NÃO é potência: entrar aqui
  // escreveria 12,4 kWh onde o desenho promete watts.
  const NAO_POTENCIA = /energy|energia|consumo|kwh|factor|fator|total/;
  const SENSOR_MATCH = {
    sensor_voltagem: [/voltagem|voltage|tens[aã]o/],
    sensor_corrente: [/corrente|current(?!_power)/],
    sensor_potencia: [/pot[eê]ncia|potencia|current_power|power/],
  };

  const powerSensors = (hass, cfg) => {
    const dev = cfg.socket_device
      || (cfg.power_entity && hass && hass.entities && hass.entities[cfg.power_entity]
        ? hass.entities[cfg.power_entity].device_id : "");
    const ids = entitiesOfDevice(hass, dev).filter((id) => id.indexOf("sensor.") === 0);
    const out = {};
    for (const [chave, regras] of Object.entries(SENSOR_MATCH)) {
      for (const re of regras) {
        const achou = ids.find((id) => {
          const r = rotulo(hass, id);
          return re.test(r) && !(chave === "sensor_potencia" && NAO_POTENCIA.test(r));
        });
        if (achou) { out[chave] = achou; break; }
      }
    }
    return out;
  };

  /* ------------------------------------------------ composição da config */

  /** a fileira de botões: o `buttons[]` do YAML manda; senão, os cinco papéis. */
  const airButtons = (hass, cfg) => {
    if (Array.isArray(cfg.buttons) && cfg.buttons.length) {
      return cfg.buttons.filter((b) => b && b.entity && b.hidden !== true).map((b) => {
        const c = { ...b }; delete c.hidden; delete c.slot; return c;
      });
    }
    const fonte = cfg.control === "infrared"
      ? { ...guessIr(hass, cfg.ir_device), ...clean(cfg.ir || {}) }
      : clean(cfg.scenes || {});
    const tomada = socketEntity(hass, cfg);
    const out = [];
    for (const s of SLOTS) {
      const ent = fonte[s.key];
      if (!ent) continue;
      const b = { entity: ent, icon: s.icon, name: s.name, color_icon: s.ink };
      if (s.paper) b.paper_color = s.paper;
      if (s.name_ink) b.color_on_name = s.name_ink;
      // sem tomada não há estado para esconder nada: mostra tudo, sempre
      if (tomada) b.show_when = { entity: tomada, state: s.when };
      out.push(deepMerge(b, (cfg.button_overrides || {})[s.key] || {}));
    }
    return out;
  };

  const sceneCard = (hass, cfg) => {
    const botoes = airButtons(hass, cfg);
    if (!botoes.length) return null;
    return {
      type: "custom:mw-scene-button-card",
      button_columns: Math.max(1, Math.min(4, Number(cfg.button_columns) || DEFAULTS.button_columns)),
      gap: 8,
      hide_label: true,
      icon_size: cfg.icon_size || DEFAULTS.icon_size,
      buttons: botoes,
      ...clean(cfg.scene_options || {}),
    };
  };

  const rainbowCard = (hass, cfg) => ({
    type: "custom:mw-rainbow-card",
    sections: (cfg.rainbow_devices || []).map((d) => (isObj(d) ? d : { device: d })),
    ...RAINBOW_DEFAULTS,
    ...clean(cfg.rainbow_options || {}),
  });

  const powerCard = (hass, cfg) => {
    const ent = socketEntity(hass, cfg);
    if (!ent) return null;
    return {
      type: "custom:power-button-card",
      entity: ent,
      ...POWER_DEFAULTS,
      ...clean(powerSensors(hass, cfg)),
      ...clean(cfg.power_options || {}),
    };
  };

  /** a config do custom:mw-tab-card que este card vai montar. */
  const buildConfig = (hass, cfg) => {
    const cards = [];

    if (cfg.rainbow !== false && (cfg.rainbow_devices || []).length) cards.push(rainbowCard(hass, cfg));

    const n = Math.max(0, Math.min(6, Number(cfg.spacers) === 0 ? 0 : (Number(cfg.spacers) || DEFAULTS.spacers)));
    const fileira = sceneCard(hass, cfg);
    const coluna = {
      type: "grid",
      square: false,
      columns: 1,
      cards: [
        ...Array.from({ length: n }, () => ({ type: "custom:mushroom-empty-card" })),
        ...(fileira ? [fileira] : [{
          type: "markdown",
          content: cfg.control === "infrared"
            ? "Escolha o **controle do MW Infrared** no editor."
            : "Escolha as **cenas** do ar no editor.",
        }]),
      ],
    };
    cards.push(cfg.image
      ? { type: "grid", columns: 2, square: false, cards: [{ type: "picture", image: cfg.image }, coluna] }
      : coluna);

    const h = cfg.heading === undefined ? DEFAULTS.heading : cfg.heading;
    if (h) cards.push({ type: "heading", heading: h, heading_style: "title" });

    for (const extra of (Array.isArray((cfg.extra_cards || {}).air) ? cfg.extra_cards.air : [])) cards.push(extra);

    const tabs = [];
    const t1 = { ...AIR_TAB, ...clean(cfg.air_tab || {}) };
    tabs.push(deepMerge({ label: t1.label, icon: t1.icon, cards }, (cfg.tabs_yaml || {}).air || {}));

    const pc = cfg.energy_tab === false ? null : powerCard(hass, cfg);
    if (pc) {
      const t2 = { ...ENERGY_TAB, ...clean(cfg.energy_tab_options || {}) };
      const eh = cfg.energy_heading === undefined ? DEFAULTS.energy_heading : cfg.energy_heading;
      const ecards = [];
      if (eh) ecards.push({ type: "heading", heading: eh, heading_style: "title" });
      const grade = {
        type: "grid",
        square: true,
        columns: Math.max(1, Math.min(6, Number(cfg.energy_columns) || 2)),
        cards: [pc].concat(Array.isArray((cfg.extra_cards || {}).energy) ? cfg.extra_cards.energy : []),
      };
      if (cfg.energy_align_start !== false) grade.card_mod = ENERGY_MOD;
      ecards.push(grade);
      tabs.push(deepMerge({ label: t2.label, icon: t2.icon, cards: ecards }, (cfg.tabs_yaml || {}).energy || {}));
    }

    for (const t of (Array.isArray(cfg.extra_tabs) ? cfg.extra_tabs : [])) tabs.push(t);

    const root = {
      type: "custom:mw-tab-card",
      tabs,
      paper_color: cfg.paper_color || DEFAULTS.paper_color,
      shell_color: cfg.shell_color || DEFAULTS.shell_color,
      ...TABS_DEFAULTS,
      ...clean(cfg.tabs_options || {}),
    };
    return deepMerge(root, cfg.yaml_override || {});
  };

  /* ------------------------------------------------------------------ CARD */

  class MwTabAirCard extends HTMLElement {
    static getConfigElement() { return document.createElement("mw-tab-air-card-editor"); }
    static getStubConfig() { return { control: "scenes", rainbow: true, energy_tab: true }; }

    setConfig(config) {
      this._config = { ...DEFAULTS, ...(config || {}) };
      this._built = null;
      this._update();
    }

    set hass(hass) {
      const antes = this._hass;
      this._hass = hass;
      const mexeu = !antes
        || antes.entities !== hass.entities
        || antes.devices !== hass.devices
        || antes.areas !== hass.areas
        || Object.keys(antes.states || {}).length !== Object.keys(hass.states || {}).length;
      if (mexeu) this._update(); else if (this._child) this._child.hass = hass;
    }
    get hass() { return this._hass; }

    set editMode(v) { this._editMode = v; if (this._child) this._child.editMode = v; }
    get editMode() { return this._editMode; }

    connectedCallback() { this._update(); }

    async getCardSize() {
      try { return this._child && this._child.getCardSize ? await this._child.getCardSize() : 8; }
      catch (_) { return 8; }
    }
    getLayoutOptions() { return { grid_min_rows: 4, grid_columns: "full" }; }
    getGridOptions() { return { columns: "full", min_rows: 4 }; }

    _shell() {
      if (!this._root) {
        this._root = this.attachShadow({ mode: "open" });
        this._root.innerHTML = `<style>
          :host{display:block;}
          .aviso{padding:14px 16px;border-radius:14px;font-size:13px;line-height:1.45;
            background:rgba(0,0,0,.25);color:var(--primary-text-color);
            border:1px solid var(--divider-color);}
          .aviso b{font-weight:700;}
          .aviso code{font-family:monospace;font-size:12px;opacity:.85;}
        </style><div id="host"></div>`;
        this._host = this._root.querySelector("#host");
      }
      return this._host;
    }

    _aviso(html) {
      const host = this._shell();
      this._child = null;
      host.innerHTML = `<div class="aviso">${html}</div>`;
    }

    async _update() {
      if (!this._config || !this.isConnected) return;
      const host = this._shell();
      if (!this._hass) return;

      const cfg = buildConfig(this._hass, this._config);
      if (!cfg.tabs.length) {
        this._aviso("<b>MW Tab Air</b><br>Escolha no editor como o ar é comandado — <b>cenas</b> ou <b>MW Infrared</b>.");
        return;
      }

      const s = sig(cfg);
      if (this._child && s === this._built) { this._child.hass = this._hass; return; }
      this._built = s;

      if (this._child) {
        try {
          this._child.setConfig(cfg);
          this._child.hass = this._hass;
          if (this._editMode !== undefined) this._child.editMode = this._editMode;
          return;
        } catch (_) { this._child = null; }
      }

      let helpers = null;
      try { helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null; } catch (_) { /* segue */ }
      let el;
      try {
        el = helpers ? helpers.createCardElement(cfg) : null;
        if (!el) throw new Error("loadCardHelpers indisponível");
      } catch (e) {
        this._aviso(`<b>MW Tab Air</b> não conseguiu montar o <code>custom:mw-tab-card</code>.<br>
          ${esc(e && e.message ? e.message : e)}<br>
          Instale <b>MW Tab Card</b>, <b>MW Scene Button Card</b>, <b>MW Rainbow Card</b>,
          <b>MW Power Button Card</b> e <b>Mushroom</b> pelo HACS.`);
        return;
      }
      el.hass = this._hass;
      if (this._editMode !== undefined) el.editMode = this._editMode;
      el.addEventListener("ll-rebuild", (ev) => { ev.stopPropagation(); this._built = null; this._child = null; this._update(); });
      host.innerHTML = "";
      host.appendChild(el);
      this._child = el;
    }
  }
  // Os editores internos do HA não vêm carregados: só entram quando alguma
  // tela de edição os pede. Instanciar o editor da pilha vertical puxa o
  // conjunto. Se não vier, o editor cai em JSON — feio, mas nunca sem saída.
  const loadHuiEditors = async () => {
    if (customElements.get("hui-card-element-editor")) return true;
    try {
      const helpers = await window.loadCardHelpers();
      const stack = helpers.createCardElement({ type: "vertical-stack", cards: [] });
      await stack.constructor.getConfigElement();
      await Promise.race([
        customElements.whenDefined("hui-card-element-editor"),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (_) { /* segue no plano B */ }
    return !!customElements.get("hui-card-element-editor");
  };

  const loadYamlEditor = async () => {
    if (customElements.get("ha-yaml-editor")) return true;
    await loadHuiEditors();
    await Promise.race([
      customElements.whenDefined("ha-yaml-editor"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    return !!customElements.get("ha-yaml-editor");
  };

  /**
   * Caixa de código de um pedaço da config. YAML quando o HA entrega o
   * ha-yaml-editor; JSON num textarea quando não entrega. Nos dois casos o
   * valor só é gravado no botão «Aplicar» — escrever a cada tecla tiraria o
   * foco de quem está digitando.
   */
  const yamlBox = async (host, hass, value, onApply, dica) => {
    host.innerHTML = `<div class="mtl-warn"></div><div class="yhost"></div>
      <div class="mtl-row"><span class="nm">${esc(dica || "")}</span>
      <button class="mtl-chip" data-apply="1">Aplicar</button></div>`;
    const warn = host.querySelector(".mtl-warn");
    const yhost = host.querySelector(".yhost");
    const ok = await loadYamlEditor();
    let ler = () => value;
    if (ok) {
      const ed = document.createElement("ha-yaml-editor");
      ed.hass = hass;
      ed.defaultValue = value;
      try { if (ed.setValue) ed.setValue(value); } catch (_) { /* versão antiga */ }
      let atual = value, valido = true;
      ed.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        valido = ev.detail.isValid !== false;
        if (valido) { atual = ev.detail.value; warn.textContent = ""; }
        else warn.textContent = "YAML inválido — corrija antes de aplicar.";
      });
      yhost.appendChild(ed);
      ler = () => { if (!valido) throw new Error("YAML inválido"); return atual; };
    } else {
      warn.textContent = "Editor YAML do HA indisponível — mostrando JSON.";
      yhost.innerHTML = `<textarea class="mtl-ta" spellcheck="false"></textarea>`;
      const ta = yhost.querySelector("textarea");
      ta.value = JSON.stringify(value, null, 2);
      ler = () => JSON.parse(ta.value);
    }
    host.querySelector("[data-apply]").addEventListener("click", () => {
      try { onApply(ler()); warn.textContent = "Aplicado."; }
      catch (e) { warn.textContent = `Não aplicado: ${e && e.message ? e.message : e}`; }
    });
  };

  const CSS = `
    .mtl-h{font-size:13px;font-weight:600;margin:14px 0 6px;opacity:.85;}
    .mtl-sec{margin-top:12px;border:1px solid var(--divider-color);border-radius:10px;padding:10px 12px;}
    .mtl-sec>summary{cursor:pointer;font-weight:600;font-size:13px;}
    .mtl-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--divider-color);}
    .mtl-row:first-of-type{border-top:0;}
    .mtl-row .nm{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .mtl-row .nm small{opacity:.6;font-size:11px;}
    .mtl-row.off .nm{opacity:.45;text-decoration:line-through;}
    .mtl-ib{border:0;background:transparent;cursor:pointer;color:var(--secondary-text-color);
      font:inherit;font-size:15px;line-height:1;padding:4px 6px;border-radius:6px;}
    .mtl-ib:hover{background:var(--divider-color);color:var(--primary-text-color);}
    .mtl-ib[disabled]{opacity:.3;cursor:default;}
    .mtl-ib.on{color:var(--primary-color);}
    .mtl-ib.del:hover{color:var(--error-color, #db4437);}
    .mtl-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;
      border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);
      font:inherit;font-size:12px;cursor:pointer;}
    .mtl-chip.add{border-style:dashed;}
    .mtl-edit{margin-top:10px;border:1px solid var(--divider-color);border-radius:10px;padding:10px;}
    .mtl-edit .top{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;font-weight:600;}
    .mtl-ta{width:100%;box-sizing:border-box;min-height:180px;font-family:monospace;font-size:12px;
      background:var(--code-editor-background-color, rgba(0,0,0,.06));color:var(--primary-text-color);
      border:1px solid var(--divider-color);border-radius:8px;padding:8px;}
    .mtl-warn{font-size:12px;color:var(--error-color, #db4437);min-height:16px;}
    .mtl-info{font-size:12px;opacity:.7;margin:4px 0 8px;}
    .mtl-crow{display:grid;grid-template-columns:1fr 44px 110px minmax(110px,1fr);gap:10px;align-items:center;padding:6px 0;}
    .mtl-crow .lbl{font-size:13px;}
    .mtl-crow input[type=color]{width:40px;height:28px;border:none;background:none;cursor:pointer;padding:0;}
    .mtl-crow code{font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  `;


  /* ---------------------------- EDITOR VISUAL ---------------------------- */

  const LABELS = {
    control: "Como o ar é comandado",
    power_entity: "Tomada (o estado dela troca os botões)",
    socket_device: "Dispositivo da tomada (Tuya, LocalTuya, Tapo…)",
    ir_device: "Controle do MW Infrared (dispositivo pareado)",
    image: "Foto do aparelho (/local/devices/…webp)",
    rainbow: "Faixa de temperatura no topo",
    energy_tab: "Criar a aba ENERGIA",
    spacers: "Espaçadores acima dos botões",
    button_columns: "Colunas da fileira de botões",
    icon_size: "Tamanho do ícone (px ou %)",
    heading: "Título da aba do aparelho (vazio = sem título)",
    energy_heading: "Título da aba de energia",
    energy_columns: "Colunas da grade de tomadas",
    energy_align_start: "Prender a tomada no topo do painel",
    paper_color: "Cor do papel (painel)",
    shell_color: "Casca (fundo do card)",
    // botão
    entity: "Entidade",
    icon: "Ícone",
    name: "Nome",
    color_icon: "Cor do ícone",
    color_on_name: "Cor do nome (aceso)",
    hide_label: "Esconder o nome (só o ícone)",
    show_when_state: "Aparece com a tomada",
    flash: "Pulso de papel ao tocar",
    gap: "Espaço entre os botões",
    button_radius: "Arredondamento dos botões",
    name_size: "Tamanho do nome",
    confirm: "Pedir confirmação",
    haptic: "Vibrar ao tocar",
    // rainbow
    orientation: "Orientação",
    band_height: "Altura da faixa",
    band_gap: "Folga entre faixas",
    band_radius: "Arredondamento da faixa",
    scale_alpha: "Opacidade das cores",
    blend: "Degradê entre as seções",
    section_labels: "Rótulos de seção",
    band_labels: "Rótulos de faixa",
    value_size: "Tamanho do valor",
    show_values: "Mostrar os valores",
    show_units: "Mostrar as unidades",
    depth: "Relevo",
    // power
    device_icon: "Ícone do aparelho",
    background_image_url: "Imagem de fundo (marca/integração)",
    protocol_icon: "Selinho de protocolo (wifi, zigbee…)",
    only_power: "Só a potência (sem tensão e corrente)",
    power_font_size: "Tamanho da potência",
    only_power_lift: "Subida do texto no modo só potência",
    sensor_voltagem: "Sensor de tensão",
    sensor_corrente: "Sensor de corrente",
    sensor_potencia: "Sensor de potência",
    // abas
    label: "Texto da aba",
    tab_position: "Posição das abas",
    tab_display: "O que aparece na aba",
    tab_stretch: "Abas dividem a faixa em partes iguais",
    tab_align: "Onde a fila de abas encosta",
    tab_size: "Espessura da faixa de abas (0 = automático)",
    tab_font_size: "Tamanho do texto da aba",
    tab_icon_size: "Tamanho do ícone da aba",
    tab_rotate: "Deitar a aba lateral",
    tab_rotate_angle: "Ângulo da aba deitada",
    tab_rotate_what: "O que gira na aba deitada",
    default_tab: "Aba inicial",
    remember_tab: "Lembrar a última aba aberta (neste navegador)",
    keep_alive: "Manter as abas já abertas montadas",
    preload: "Montar todas as abas de uma vez",
    header: "Faixa de título (opcional)",
    header_icon: "Ícone da faixa de título",
    shell_radius: "Arredondamento da casca",
    panel_radius: "Arredondamento do painel",
    notch_radius: "Recorte côncavo (fusão aba↔painel)",
    padding: "Respiro entre casca e painel",
    content_padding: "Respiro interno do painel",
    card_gap: "Espaço entre os cards de dentro",
    panel_min_height: "Altura mínima do painel",
    elevation: "Relevo 3D no painel",
    flat_children: "Achatar os cards de dentro",
    tab_active_color: "Aba ativa: texto",
    tab_inactive_color: "Aba inativa: texto",
    content_text_color: "Texto dentro do painel",
    header_color: "Faixa de título (vazio = clareia a casca)",
    header_text_color: "Texto da faixa de título",
  };

  const POS_OPTIONS = [
    { value: "bottom", label: "Embaixo" }, { value: "top", label: "Em cima" },
    { value: "left", label: "À esquerda" }, { value: "right", label: "À direita" },
  ];
  const DISP_OPTIONS = [
    { value: "both", label: "Ícone e texto" }, { value: "icon", label: "Só ícone" },
    { value: "text", label: "Só texto" },
  ];
  const CONTROL_OPTIONS = [
    { value: "scenes", label: "Cenas do Home Assistant" },
    { value: "infrared", label: "MW Infrared Controller (teclas IR)" },
  ];
  const LABEL_OPTIONS = [
    { value: "none", label: "Nenhum" }, { value: "first", label: "Só o primeiro" }, { value: "all", label: "Todos" },
  ];
  const BANDLABEL_OPTIONS = [
    { value: "none", label: "Nenhum" }, { value: "icon", label: "Ícone" }, { value: "text", label: "Texto" },
  ];

  class MwTabAirCardEditor extends HTMLElement {
    setConfig(config) { this._config = { ...config }; this._render(); }
    set hass(hass) {
      this._hass = hass;
      for (const f of this._forms || []) f.hass = hass;
      if (this._reg !== (hass && hass.entities)) { this._reg = hass && hass.entities; this._renderSlots(); this._renderRainbow(); }
    }

    _emit(next) {
      this._config = next;
      this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: next } }));
    }
    _patch(patch) {
      const next = { ...this._config, ...patch };
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null) delete next[k];
        else if (k in DEFAULTS && v === DEFAULTS[k] && k !== "control") delete next[k];
      }
      this._emit(next);
    }
    _cfg() { return { ...DEFAULTS, ...this._config }; }
    _fonte() { return this._cfg().control === "infrared" ? "ir" : "scenes"; }

    _render() {
      if (!this._root) {
        this._forms = [];
        this._root = document.createElement("div");
        this._root.innerHTML = `<style>${CSS}</style>
          <div id="mainform"></div>
          <div class="mtl-h">Botões do aparelho</div>
          <div class="mtl-info" id="sinfo"></div>
          <div id="slotform"></div>
          <div id="slots"></div>
          <div id="slotedit"></div>
          <details class="mtl-sec" id="btsec"><summary>Fileira de botões (todas as opções)</summary>
            <div id="btform"></div>
            <details class="mtl-sec"><summary>Código YAML desta fileira</summary><div id="btyaml"></div></details></details>
          <details class="mtl-sec" id="rbsec"><summary>Faixa de temperatura (arco-íris)</summary>
            <div class="mtl-info">Cada seção é um dispositivo com sensor de temperatura — a ordem é a da fila.</div>
            <div id="rainbow"></div><div id="rbadd"></div><div id="rbform"></div>
            <details class="mtl-sec"><summary>Código YAML deste card</summary><div id="rbyaml"></div></details></details>
          <details class="mtl-sec" id="pwsec"><summary>Tomada (aba ENERGIA)</summary>
            <div class="mtl-info" id="pwinfo"></div>
            <div id="pwform"></div>
            <details class="mtl-sec"><summary>Código YAML deste card</summary><div id="pwyaml"></div></details></details>
          <details class="mtl-sec" id="tabsec"><summary>Abas (rótulo, ícone, posição, tamanho…)</summary>
            <div class="mtl-h">Aba do aparelho</div><div id="tab1form"></div>
            <div class="mtl-h">Aba de energia</div><div id="tab2form"></div>
            <div class="mtl-h">Comportamento e geometria</div><div id="tabsform"></div></details>
          <details class="mtl-sec" id="colorsec"><summary>Cores (papel, casca e textos)</summary>
            <div id="paperform"></div><div id="colorrows"></div></details>
          <details class="mtl-sec" id="yamlsec"><summary>Código YAML do card inteiro (avançado)</summary>
            <div class="mtl-h">Config gerada — é isto que vai para o mw-tab-card</div><div id="yamlgen"></div>
            <div class="mtl-h">Ajustes crus (merge por cima do gerado)</div><div id="yamlover"></div></details>`;
        this.appendChild(this._root);

        const form = (sel, cb) => {
          const f = document.createElement("ha-form");
          f.computeLabel = (x) => LABELS[x.name] || x.name;
          f.addEventListener("value-changed", (ev) => { ev.stopPropagation(); cb(ev.detail.value || {}); });
          this._root.querySelector(sel).appendChild(f);
          this._forms.push(f);
          return f;
        };
        this._mainForm = form("#mainform", (v) => this._onMain(v));
        this._slotForm = form("#slotform", (v) => this._onSlots(v));
        this._btForm = form("#btform", (v) => this._patch({ scene_options: clean(v) }));
        this._rbForm = form("#rbform", (v) => this._patch({ rainbow_options: clean(v) }));
        this._rbAdd = form("#rbadd", (v) => this._onRainbowAdd(v));
        this._pwForm = form("#pwform", (v) => this._onPower(v));
        this._tab1Form = form("#tab1form", (v) => this._patch({ air_tab: clean(v) }));
        this._tab2Form = form("#tab2form", (v) => this._patch({ energy_tab_options: clean(v) }));
        this._tabsForm = form("#tabsform", (v) => this._onTabs(v));
        this._paperForm = form("#paperform", (v) => this._patch({ paper_color: v.paper_color }));

        this._slotsEl = this._root.querySelector("#slots");
        this._slotEditEl = this._root.querySelector("#slotedit");
        this._rainbowEl = this._root.querySelector("#rainbow");
        this._colorRows = this._root.querySelector("#colorrows");

        for (const [sel, fn] of [["#yamlsec", "_renderYaml"], ["#btsec", "_renderYamlPieces"],
          ["#rbsec", "_renderYamlPieces"], ["#pwsec", "_renderYamlPieces"]]) {
          this._root.querySelector(sel).addEventListener("toggle", () => this[fn]());
        }
      }
      this._renderMain();
      this._renderSlots();
      this._renderRainbow();
      this._renderChildForms();
      this._renderTabForms();
      this._renderColors();
    }

    /* ------------------------------ principal ----------------------------- */

    _renderMain() {
      const c = this._cfg();
      this._mainForm.hass = this._hass;
      this._mainForm.schema = [
        { name: "control", selector: { select: { mode: "dropdown", options: CONTROL_OPTIONS } } },
        ...(c.control === "infrared" ? [{ name: "ir_device", selector: { device: {} } }] : []),
        { name: "power_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
        { name: "image", selector: { text: {} } },
        { name: "", type: "grid", schema: [
          { name: "rainbow", selector: { boolean: {} } },
          { name: "energy_tab", selector: { boolean: {} } },
          { name: "spacers", selector: { number: { min: 0, max: 6, step: 1, mode: "box" } } },
          { name: "button_columns", selector: { number: { min: 1, max: 4, step: 1, mode: "box" } } },
          { name: "icon_size", selector: { text: {} } },
        ] },
        { name: "heading", selector: { text: {} } },
        ...(c.energy_tab !== false ? [
          { name: "socket_device", selector: { device: {} } },
          { name: "energy_heading", selector: { text: {} } },
          { name: "", type: "grid", schema: [
            { name: "energy_columns", selector: { number: { min: 1, max: 6, step: 1, mode: "box" } } },
            { name: "energy_align_start", selector: { boolean: {} } },
          ] },
        ] : []),
      ];
      const data = {
        control: c.control, ir_device: c.ir_device, power_entity: c.power_entity,
        socket_device: c.socket_device, image: c.image, heading: c.heading,
        rainbow: c.rainbow !== false, energy_tab: c.energy_tab !== false,
        spacers: c.spacers, button_columns: c.button_columns, icon_size: c.icon_size,
        energy_heading: c.energy_heading, energy_columns: c.energy_columns || 2,
        energy_align_start: c.energy_align_start !== false,
      };
      for (const k of Object.keys(data)) if (data[k] === "" || data[k] === undefined) delete data[k];
      this._mainForm.data = data;
    }

    _onMain(v) {
      const um = (x) => (Array.isArray(x) ? x[0] : x);
      const patch = {
        control: v.control || "scenes",
        ir_device: um(v.ir_device) || "",
        power_entity: um(v.power_entity) || "",
        socket_device: um(v.socket_device) || "",
        image: v.image || "",
        heading: v.heading === undefined ? this._config.heading : v.heading,
        energy_heading: v.energy_heading === undefined ? this._config.energy_heading : v.energy_heading,
        rainbow: v.rainbow !== false,
        energy_tab: v.energy_tab !== false,
        spacers: Number(v.spacers ?? DEFAULTS.spacers),
        button_columns: Number(v.button_columns) || DEFAULTS.button_columns,
        icon_size: v.icon_size || DEFAULTS.icon_size,
        energy_columns: Number(v.energy_columns) || 2,
        energy_align_start: v.energy_align_start !== false,
      };
      if (patch.energy_columns === 2) delete patch.energy_columns;
      if (patch.energy_align_start === true) delete patch.energy_align_start;
      this._patch(patch);
      this._renderMain();
      this._renderSlots();
      this._renderChildForms();
    }

    /* -------------------------------- botões ------------------------------ */

    _renderSlots() {
      if (!this._slotForm || !this._config) return;
      const c = this._cfg();
      const fonte = this._fonte();
      const ir = c.control === "infrared" && this._hass ? guessIr(this._hass, c.ir_device) : {};
      const atual = { ...ir, ...(c[fonte] || {}) };
      const dominio = c.control === "infrared" ? ["button", "script"] : ["scene", "script"];
      this._slotForm.hass = this._hass;
      this._slotForm.computeLabel = (x) => SLOT_LABEL[x.name] || LABELS[x.name] || x.name;
      this._slotForm.schema = SLOTS.map((s) => ({ name: s.key, selector: { entity: { domain: dominio } } }));
      const data = {};
      for (const s of SLOTS) if (atual[s.key]) data[s.key] = atual[s.key];
      this._slotForm.data = data;

      const info = this._root.querySelector("#sinfo");
      info.textContent = c.control === "infrared"
        ? (c.ir_device
          ? `${irButtons(this._hass, c.ir_device).length} tecla(s) no controle «${deviceName(this._hass, c.ir_device)}» — os papéis abaixo já vêm palpitados.`
          : "Escolha o controle do MW Infrared para o card achar as teclas.")
        : "Escolha as cenas de cada papel. Papel sem cena não vira botão.";

      const botoes = this._hass ? airButtons(this._hass, c) : [];
      this._btns = botoes;
      const s = sig(botoes);
      if (s === this._bsig && this._slotsEl.children.length) return;
      this._bsig = s;
      this._slotsEl.innerHTML = botoes.map((b, i) => {
        const slot = SLOTS[i] && !c.buttons ? SLOTS.find((x) => {
          const fonteId = (atual[x.key] || "");
          return fonteId === b.entity;
        }) : null;
        return `<div class="mtl-row">
          <span class="nm">${esc(b.name || "")} <small>${esc(b.entity)}${b.show_when ? ` · só com a tomada ${esc(b.show_when.state)}` : ""}</small></span>
          <button class="mtl-ib" data-a="edit" data-k="${esc(slot ? slot.key : "")}" title="aparência">✎</button>
        </div>`;
      }).join("") || `<div class="mtl-info">Nenhum botão ainda.</div>`;
      this._slotsEl.querySelectorAll("[data-a]").forEach((b) =>
        b.addEventListener("click", () => { this._slot = b.dataset.k || null; this._renderSlotEditor(); }));
      this._renderSlotEditor();
    }

    _onSlots(v) {
      const fonte = this._fonte();
      const atual = { ...(this._config[fonte] || {}) };
      for (const s of SLOTS) {
        const ent = Array.isArray(v[s.key]) ? v[s.key][0] : v[s.key];
        if (ent) atual[s.key] = ent; else delete atual[s.key];
      }
      this._bsig = null;
      this._patch({ [fonte]: Object.keys(atual).length ? atual : undefined });
      this._renderSlots();
    }

    _renderSlotEditor() {
      if (!this._slotEditEl) return;
      this._slotEditEl.innerHTML = "";
      const key = this._slot;
      if (!key) return;
      const slot = SLOTS.find((s) => s.key === key);
      if (!slot) return;
      const box = document.createElement("div");
      box.className = "mtl-edit";
      box.innerHTML = `<div class="top"><span>${esc(SLOT_LABEL[key] || key)}</span>
        <span style="flex:1"></span><button class="mtl-ib" data-close="1">✕</button></div><div class="host"></div>`;
      box.querySelector("[data-close]").addEventListener("click", () => { this._slot = null; this._renderSlotEditor(); });
      this._slotEditEl.appendChild(box);

      const over = (this._config.button_overrides || {})[key] || {};
      const base = { icon: slot.icon, name: slot.name, color_icon: slot.ink,
        paper_color: slot.paper || "paper", color_on_name: slot.name_ink || "",
        show_when_state: slot.when };
      const f = document.createElement("ha-form");
      f.hass = this._hass;
      f.computeLabel = (x) => LABELS[x.name] || x.name;
      f.schema = [
        { name: "", type: "grid", schema: [
          { name: "icon", selector: { icon: {} } },
          { name: "name", selector: { text: {} } },
        ] },
        { name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } },
        { name: "color_icon", selector: { text: {} } },
        { name: "color_on_name", selector: { text: {} } },
        { name: "show_when_state", selector: { select: { mode: "dropdown", options: [
          { value: "off", label: "Apagada (aparelho desligado)" },
          { value: "on", label: "Acesa (aparelho ligado)" },
          { value: "", label: "Sempre (sem condição)" }] } } },
      ];
      f.data = { ...base, ...over, show_when_state: over.show_when
        ? over.show_when.state : (over.show_when === null ? "" : base.show_when_state) };
      f.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const v = { ...ev.detail.value };
        const estado = v.show_when_state;
        delete v.show_when_state;
        const novo = {};
        for (const [k, val] of Object.entries(v)) if (val !== "" && val !== base[k]) novo[k] = val;
        const tomada = this._hass ? socketEntity(this._hass, this._cfg()) : "";
        if (estado === "") novo.show_when = null;
        else if (estado && estado !== slot.when && tomada) novo.show_when = { entity: tomada, state: estado };
        const todos = { ...(this._config.button_overrides || {}) };
        if (Object.keys(novo).length) todos[key] = novo; else delete todos[key];
        this._bsig = null;
        this._patch({ button_overrides: Object.keys(todos).length ? todos : undefined });
      });
      box.querySelector(".host").appendChild(f);
    }

    /* ------------------------------- arco-íris ---------------------------- */

    _renderRainbow() {
      if (!this._rainbowEl || !this._config) return;
      const devs = (this._config.rainbow_devices || []).map((d) => (isObj(d) ? d.device : d));
      const s = sig(devs);
      if (s === this._rsig && this._rainbowEl.children.length) return;
      this._rsig = s;
      const n = devs.length;
      this._rainbowEl.innerHTML = devs.map((d, i) => `
        <div class="mtl-row">
          <span class="nm">${esc(this._hass ? deviceName(this._hass, d) : d)}</span>
          <button class="mtl-ib" data-a="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="mtl-ib" data-a="down" data-i="${i}" ${i === n - 1 ? "disabled" : ""}>↓</button>
          <button class="mtl-ib del" data-a="del" data-i="${i}">✕</button>
        </div>`).join("") || `<div class="mtl-info">Nenhum dispositivo — a faixa não é desenhada.</div>`;
      this._rainbowEl.querySelectorAll("[data-a]").forEach((b) =>
        b.addEventListener("click", () => this._rbAction(b.dataset.a, +b.dataset.i)));
      this._rbAdd.hass = this._hass;
      this._rbAdd.schema = [{ name: "add", selector: { device: { entity: { device_class: "temperature" } } } }];
      this._rbAdd.data = {};
      this._rbAdd.computeLabel = () => "+ dispositivo com temperatura";
    }

    _rbAction(a, i) {
      const devs = (this._config.rainbow_devices || []).map((d) => (isObj(d) ? d.device : d));
      if (a === "up" && i > 0) [devs[i - 1], devs[i]] = [devs[i], devs[i - 1]];
      else if (a === "down" && i < devs.length - 1) [devs[i + 1], devs[i]] = [devs[i], devs[i + 1]];
      else if (a === "del") devs.splice(i, 1);
      else return;
      this._rsig = null;
      this._patch({ rainbow_devices: devs.map((d) => ({ device: d })) });
      this._renderRainbow();
    }

    _onRainbowAdd(v) {
      const id = Array.isArray(v.add) ? v.add[0] : v.add;
      if (!id) return;
      const devs = (this._config.rainbow_devices || []).map((d) => (isObj(d) ? d.device : d));
      if (devs.includes(id)) return;
      devs.push(id);
      this._rsig = null;
      this._patch({ rainbow_devices: devs.map((d) => ({ device: d })) });
      this._renderRainbow();
    }

    /* --------------------------- cards de dentro -------------------------- */

    _renderChildForms() {
      const c = this._cfg();
      // ---- mw-scene-button-card (a fileira)
      const b = { button_columns: c.button_columns, gap: 8, button_radius: 12, hide_label: true,
        icon_size: c.icon_size, name_size: 11, flash: true, confirm: false, haptic: true,
        paper_color: "paper", ...(c.scene_options || {}) };
      this._btForm.hass = this._hass;
      this._btForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "button_columns", selector: { number: { min: 1, max: 4, step: 1, mode: "box" } } },
          { name: "gap", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "button_radius", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "icon_size", selector: { text: {} } },
          { name: "name_size", selector: { number: { min: 6, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "hide_label", selector: { boolean: {} } },
          { name: "flash", selector: { boolean: {} } },
          { name: "confirm", selector: { boolean: {} } },
          { name: "haptic", selector: { boolean: {} } },
        ] },
        { name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } },
      ];
      this._btForm.data = b;

      // ---- mw-rainbow-card
      const r = { ...RAINBOW_DEFAULTS, band_height: 34, band_gap: 4, band_radius: 8,
        scale_alpha: 0.85, blend: true, show_values: true, show_units: true,
        depth: "soft", paper_color: "none", ...(c.rainbow_options || {}) };
      this._rbForm.hass = this._hass;
      this._rbForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "orientation", selector: { select: { mode: "dropdown", options: [
            { value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertical" }] } } },
          { name: "band_height", selector: { number: { min: 10, max: 120, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "band_gap", selector: { number: { min: 0, max: 20, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "band_radius", selector: { number: { min: 0, max: 30, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "name_size", selector: { number: { min: 8, max: 30, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "value_size", selector: { number: { min: 8, max: 30, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "section_labels", selector: { select: { mode: "dropdown", options: LABEL_OPTIONS } } },
          { name: "band_labels", selector: { select: { mode: "dropdown", options: BANDLABEL_OPTIONS } } },
          { name: "show_values", selector: { boolean: {} } },
          { name: "show_units", selector: { boolean: {} } },
          { name: "blend", selector: { boolean: {} } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "scale_alpha", selector: { number: { min: 0, max: 1, step: 0.05, mode: "box" } } },
          { name: "depth", selector: { select: { mode: "dropdown", options: [
            { value: "flat", label: "Sem relevo" }, { value: "soft", label: "Suave" }, { value: "3d", label: "3D" }] } } },
          { name: "paper_color", selector: { select: { mode: "dropdown",
            options: [{ value: "none", label: "Fundo do tema" }].concat(paperOptions()) } } },
        ] },
      ];
      const rdata = { ...r }; delete rdata.bands; delete rdata.sections; delete rdata.grid_options;
      this._rbForm.data = rdata;

      // ---- power-button-card
      const auto = this._hass ? powerSensors(this._hass, c) : {};
      const p = { ...POWER_DEFAULTS, paper_color: "paper", ...auto, ...(c.power_options || {}) };
      const info = this._root.querySelector("#pwinfo");
      if (info) {
        const achados = Object.values(auto).filter(Boolean).length;
        info.textContent = socketEntity(this._hass || {}, c)
          ? `${achados} de 3 sensores achados no dispositivo da tomada (Tuya, LocalTuya, Tapo…). Vazio = o card descobre sozinho.`
          : "Escolha a tomada (entidade ou dispositivo) para criar a aba de energia.";
      }
      this._pwForm.hass = this._hass;
      this._pwForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "name", selector: { text: {} } },
          { name: "device_icon", selector: { icon: {} } },
          { name: "protocol_icon", selector: { icon: {} } },
        ] },
        { name: "background_image_url", selector: { text: {} } },
        { name: "", type: "grid", schema: [
          { name: "only_power", selector: { boolean: {} } },
          { name: "confirm", selector: { boolean: {} } },
          { name: "haptic", selector: { boolean: {} } },
          { name: "power_font_size", selector: { number: { min: 8, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "only_power_lift", selector: { number: { min: -20, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "expandable", title: "Sensores (vazio = descobre pelo dispositivo da tomada)", schema: [
          { name: "sensor_voltagem", selector: { entity: { domain: "sensor" } } },
          { name: "sensor_corrente", selector: { entity: { domain: "sensor" } } },
          { name: "sensor_potencia", selector: { entity: { domain: "sensor" } } },
        ] },
        { name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } },
      ];
      this._pwForm.data = p;
    }

    _onPower(v) {
      const o = clean({ ...v });
      const auto = this._hass ? powerSensors(this._hass, this._cfg()) : {};
      for (const k of ["sensor_voltagem", "sensor_corrente", "sensor_potencia"]) {
        const val = Array.isArray(o[k]) ? o[k][0] : o[k];
        if (!val || val === auto[k]) delete o[k]; else o[k] = val;
      }
      for (const [k, val] of Object.entries(POWER_DEFAULTS)) if (o[k] === val) delete o[k];
      this._patch({ power_options: Object.keys(o).length ? o : undefined });
    }

    /* -------------------------------- abas -------------------------------- */

    _renderTabForms() {
      const t1 = { ...AIR_TAB, ...(this._config.air_tab || {}) };
      const t2 = { ...ENERGY_TAB, ...(this._config.energy_tab_options || {}) };
      const tabSchema = [{ name: "", type: "grid", schema: [
        { name: "label", selector: { text: {} } }, { name: "icon", selector: { icon: {} } } ] }];
      this._tab1Form.hass = this._hass; this._tab1Form.schema = tabSchema; this._tab1Form.data = t1;
      this._tab2Form.hass = this._hass; this._tab2Form.schema = tabSchema; this._tab2Form.data = t2;

      const o = { ...TABS_DEFAULTS, ...(this._config.tabs_options || {}) };
      const horiz = o.tab_position === "top" || o.tab_position === "bottom";
      this._tabsForm.hass = this._hass;
      this._tabsForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "tab_position", selector: { select: { mode: "dropdown", options: POS_OPTIONS } } },
          { name: "tab_display", selector: { select: { mode: "dropdown", options: DISP_OPTIONS } } },
          { name: "tab_icon_size", selector: { number: { min: 10, max: 48, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "tab_font_size", selector: { number: { min: 7, max: 28, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "tab_size", selector: { number: { min: 0, max: 240, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "default_tab", selector: { number: { min: 0, max: 5, step: 1, mode: "box" } } },
        ] },
        ...(horiz ? [{ name: "tab_stretch", selector: { boolean: {} } }] : [
          { name: "tab_rotate", selector: { select: { mode: "dropdown", options: [
            { value: "auto", label: "Automático (deita em retrato)" },
            { value: "true", label: "Sempre deitada" }, { value: "false", label: "Nunca" }] } } },
          { name: "tab_rotate_angle", selector: { select: { mode: "dropdown", options: [
            { value: "auto", label: "Automático" }, { value: "90", label: "90°" }, { value: "270", label: "270°" }] } } },
          { name: "tab_rotate_what", selector: { select: { mode: "dropdown", options: [
            { value: "both", label: "Ícone e texto" }, { value: "text", label: "Só o texto" },
            { value: "icon", label: "Só o ícone" }] } } },
        ]),
        { name: "tab_align", selector: { select: { mode: "dropdown", options: [
          { value: "", label: "Automático" }, { value: "start", label: "No começo" },
          { value: "center", label: "No centro" }, { value: "end", label: "No fim" } ] } } },
        { name: "header", selector: { text: {} } },
        { name: "header_icon", selector: { icon: {} } },
        { name: "", type: "grid", schema: [
          { name: "shell_radius", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "panel_radius", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "notch_radius", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "padding", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "content_padding", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "card_gap", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "panel_min_height", selector: { number: { min: 0, max: 800, step: 4, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "elevation", selector: { boolean: {} } },
          { name: "flat_children", selector: { boolean: {} } },
          { name: "haptic", selector: { boolean: {} } },
          { name: "keep_alive", selector: { boolean: {} } },
          { name: "remember_tab", selector: { boolean: {} } },
          { name: "preload", selector: { boolean: {} } },
        ] },
      ];
      const data = { ...o };
      for (const k of Object.keys(data)) if (data[k] === "" || data[k] === undefined) delete data[k];
      this._tabsForm.data = data;
    }

    _onTabs(v) {
      const o = clean({ ...(this._config.tabs_options || {}), ...v });
      for (const [k, val] of Object.entries(TABS_DEFAULTS)) if (o[k] === undefined) o[k] = val;
      this._patch({ tabs_options: o });
      this._renderTabForms();
    }

    /* ------------------------------- cores -------------------------------- */

    _renderColors() {
      this._paperForm.hass = this._hass;
      this._paperForm.schema = [{ name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } }];
      this._paperForm.data = { paper_color: this._config.paper_color || DEFAULTS.paper_color };

      const campos = [
        ["shell_color", null],
        ["tab_active_color", "tabs_options"], ["tab_inactive_color", "tabs_options"],
        ["content_text_color", "tabs_options"], ["header_color", "tabs_options"],
        ["header_text_color", "tabs_options"],
      ];
      const valor = (name, onde) => (onde ? (this._config[onde] || {})[name] : this._config[name])
        ?? (name === "shell_color" ? DEFAULTS.shell_color : "");
      this._colorRows.innerHTML = campos.map(([name, onde]) => {
        const cur = valor(name, onde);
        const col = parseColor(cur || "rgba(128,128,128,1)");
        return `<div class="mtl-crow" data-name="${name}" data-onde="${onde || ""}">
          <span class="lbl">${LABELS[name] || name}</span>
          <input type="color" value="${toHex(col)}" title="cor">
          <input type="range" min="0" max="1" step="0.01" value="${col.a}" title="transparência (alfa)">
          <code>${esc(cur || "—")}</code></div>`;
      }).join("");
      this._colorRows.querySelectorAll(".mtl-crow").forEach((row) => {
        const name = row.dataset.name, onde = row.dataset.onde;
        const apply = () => {
          const { r, g, b } = parseColor(row.querySelector("input[type=color]").value);
          const a = parseFloat(row.querySelector("input[type=range]").value);
          const v = toRgba({ r, g, b, a });
          if (onde) this._patch({ [onde]: { ...(this._config[onde] || {}), [name]: v } });
          else this._patch({ [name]: v });
          row.querySelector("code").textContent = v;
        };
        row.querySelector("input[type=color]").addEventListener("input", apply);
        row.querySelector("input[type=range]").addEventListener("input", apply);
      });
    }

    /* -------------------------------- yaml -------------------------------- */

    async _renderYamlPieces() {
      if (!this._hass) return;
      const c = this._cfg();
      const pecas = [
        ["#btsec", "#btyaml", sceneCard(this._hass, c), "scene_options"],
        ["#rbsec", "#rbyaml", rainbowCard(this._hass, c), "rainbow_options"],
        ["#pwsec", "#pwyaml", powerCard(this._hass, c), "power_options"],
      ];
      for (const [secSel, hostSel, gerado, chave] of pecas) {
        const sec = this._root.querySelector(secSel);
        const host = this._root.querySelector(hostSel);
        if (!sec.open || !host || !gerado) continue;
        if (host.dataset.pronto === sig(gerado)) continue;
        host.dataset.pronto = sig(gerado);
        await yamlBox(host, this._hass, gerado, (val) => {
          const over = diffObj(gerado, val);
          delete over.type;
          this._patch({ [chave]: { ...(this._config[chave] || {}), ...over } });
          host.dataset.pronto = "";
          this._renderChildForms();
        }, "grava só o que você mudou (merge sobre o gerado)");
      }
    }

    async _renderYaml() {
      const sec = this._root.querySelector("#yamlsec");
      if (!sec.open || !this._hass) return;
      const gerado = buildConfig(this._hass, this._cfg());
      await yamlBox(this._root.querySelector("#yamlgen"), this._hass, gerado, (val) => {
        this._patch({ yaml_override: diffObj(gerado, val) });
      }, "editar aqui grava as diferenças em yaml_override");
      await yamlBox(this._root.querySelector("#yamlover"), this._hass, this._config.yaml_override || {}, (val) => {
        this._patch({ yaml_override: isObj(val) && Object.keys(val).length ? val : undefined });
      }, "merge por cima do gerado (null apaga uma chave)");
    }
  }

  /* --------------------------------- registro -------------------------------- */

  customElements.define("mw-tab-air-card", MwTabAirCard);
  customElements.define("mw-tab-air-card-editor", MwTabAirCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "mw-tab-air-card",
    name: "MW Tab Air",
    description: "O ar-condicionado em abas: temperatura da casa, foto, botões de cena ou IR e a tomada.",
    preview: true,
    documentationURL: "https://github.com/visaodeempresa/mw-ha-tab-air-card",
  });

  console.info(`%c MW-TAB-AIR-CARD %c ${VERSION} `,
    "background:#1a1a1a;color:#fdfaf3;font-weight:700;", "background:#e8e3d8;color:#1a1a1a;font-weight:700;");
})();
