# MW Tab Air Card

`custom:mw-tab-air-card` — o ar-condicionado inteiro em abas.

| aba | o que entra |
|---|---|
| **AR-CONDICIONADO** | faixa de temperatura da casa (`mw-rainbow-card`) · foto · fileira de botões de papel (`mw-scene-button-card`) |
| **ENERGIA** | a tomada em `power-button-card`, com tensão/corrente/potência achados sozinhos |

Compositor: a casca e as abas são do `custom:mw-tab-card`; nada é redesenhado aqui.

## Dois modos de comando

| modo | de onde vem o toque |
|---|---|
| `control: scenes` | cenas do HA (`scene.*`) |
| `control: infrared` | teclas do **MW Infrared Controller** (`button.*` do controle pareado) |

Os cinco papéis: **preparar · ligar · desligar · menos · mais**. O que aparece
depende do estado da tomada (`show_when`): apagada mostra preparar e ligar;
acesa mostra desligar, menos e mais.

## Tomada: Tuya, LocalTuya, Tapo ou manual

Os sensores saem do dispositivo da tomada por nome, em português **e** inglês
(`voltagem`/`voltage`, `corrente`/`current`, `potência`/`current_power`).
Energia acumulada (kWh, `today_energy`) nunca entra como potência. Qualquer um
dos três pode ser escolhido à mão no editor.

## Exemplo

```yaml
type: custom:mw-tab-air-card
power_entity: switch.tomada_ar_escritorio
socket_device: <id da tomada>
image: /local/devices/ar-britania-rab.webp
scenes:
  prepare: scene.ar_escritorio
  on: scene.ligar_ar_escritorio
  off: scene.desligar_ar_escritorio
  down: scene.reduzir_o_ar_do_escritorio
  up: scene.aumentar_o_ar_do_escritorio
rainbow_devices:
  - device: 2b2e01fa4c728068236f012cf609905a
```

## Depende de (HACS)

`MW Tab Card` · `MW Scene Button Card` (≥ 0.4.0, que aceita `button.*`) ·
`MW Rainbow Card` · `MW Power Button Card` · `Mushroom`

## Verificação

```bash
node --check dist/mw-tab-air-card.js && node tools/probe.js
```

---

Autoria: MAYCON WILLIAN OLIVEIRA <visaodeempresa@gmail.com>
