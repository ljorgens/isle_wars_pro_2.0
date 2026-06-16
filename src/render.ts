// SVG map renderer: ocean, rhumb lines, compass rose, sea lanes, islands,
// countries, labels, and battle/disaster effects.
import type { WorldMap } from './geometry';
import type { GameState } from './types';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

export class Renderer {
  svg!: SVGSVGElement;
  countryEls: SVGPathElement[] = [];
  countEls: SVGTextElement[] = [];
  numEls: SVGTextElement[] = [];
  arrowEl!: SVGGElement;
  fxLayer!: SVGGElement;
  onCountryClick: (id: number) => void = () => {};
  playerColors: string[] = [];

  constructor(public world: WorldMap) {}

  init(svg: SVGSVGElement) {
    this.svg = svg;
    const { width: w, height: h } = this.world;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    // ----- defs -----
    const defs = el('defs', {}, svg);
    const grad = el('radialGradient', { id: 'ocean', cx: '0.5', cy: '0.42', r: '0.85' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#17405e' }, grad);
    el('stop', { offset: '60%', 'stop-color': '#102e47' }, grad);
    el('stop', { offset: '100%', 'stop-color': '#0a1f33' }, grad);

    const water = el('filter', { id: 'waterTex', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.012 0.02', numOctaves: 2, seed: 7, result: 'n' }, water);
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.4  0 0 0 0 0.55  0 0 0 0 0.7  0 0 0 0.05 0' }, water);
    el('feComposite', { in2: 'SourceGraphic', operator: 'over' }, water);

    const paper = el('filter', { id: 'landTex', x: '-8%', y: '-8%', width: '116%', height: '116%' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 2, seed: 3, result: 'g' }, paper);
    el('feColorMatrix', { in: 'g', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0', result: 'grain' }, paper);
    el('feComposite', { in: 'grain', in2: 'SourceGraphic', operator: 'over' }, paper);

    const shadow = el('filter', { id: 'isleShadow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    el('feDropShadow', { dx: 0, dy: 5, stdDeviation: 6, 'flood-color': '#020a14', 'flood-opacity': 0.55 }, shadow);

    // ----- ocean -----
    el('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#ocean)' }, svg);
    el('rect', { x: 0, y: 0, width: w, height: h, fill: '#fff', opacity: 0.04, filter: 'url(#waterTex)' }, svg);

    // rhumb lines radiating from the compass rose
    const rhumbs = el('g', { stroke: '#9db9cf', 'stroke-width': 0.6, opacity: 0.07 }, svg);
    const rcx = w - 92, rcy = h - 86;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      el('line', { x1: rcx, y1: rcy, x2: rcx + Math.cos(a) * 1400, y2: rcy + Math.sin(a) * 1400 }, rhumbs);
    }

    // compass rose
    const rose = el('g', { transform: `translate(${rcx} ${rcy})`, opacity: 0.5 }, svg);
    el('circle', { r: 34, fill: 'none', stroke: '#c8b78a', 'stroke-width': 1 }, rose);
    el('circle', { r: 27, fill: 'none', stroke: '#c8b78a', 'stroke-width': 0.5, 'stroke-dasharray': '2 3' }, rose);
    let star = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const ro = i % 2 === 0 ? 30 : 12;
      star += `${i ? 'L' : 'M'}${Math.cos(a) * ro} ${Math.sin(a) * ro}`;
    }
    el('path', { d: star + 'Z', fill: '#c8b78a', opacity: 0.85 }, rose);
    const nText = el('text', { y: -40, 'text-anchor': 'middle', fill: '#c8b78a', 'font-size': 13, class: 'rose-n' }, rose);
    nText.textContent = 'N';

    // ----- sea lanes -----
    const lanes = el('g', {}, svg);
    for (const [a, b] of this.world.lanes) {
      const [x1, y1] = this.world.countries[a].centroid;
      const [x2, y2] = this.world.countries[b].centroid;
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12;
      const my = (y1 + y2) / 2 + (x1 - x2) * 0.12;
      el('path', {
        d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`,
        class: 'lane',
        fill: 'none',
      }, lanes);
    }

    // ----- islands ----- (sand rim + shadow under countries)
    const isles = el('g', { filter: 'url(#isleShadow)' }, svg);
    for (const isl of this.world.islands) {
      el('path', { d: isl.path, fill: '#d8c693', stroke: '#caa968', 'stroke-width': 7, 'stroke-linejoin': 'round' }, isles);
    }

    // ----- countries -----
    const countriesG = el('g', { filter: 'url(#landTex)' }, svg);
    for (const c of this.world.countries) {
      const path = el('path', {
        d: c.path,
        class: 'country',
        'data-id': c.id,
      }, countriesG);
      const isl = this.world.islands[c.island];
      const tip = el('title', {}, path);
      tip.textContent = `Country ${c.id + 1} — ${isl.name} (+${isl.bonus})`;
      path.addEventListener('click', () => this.onCountryClick(c.id));
      this.countryEls[c.id] = path;
    }

    // island name plaques
    const names = el('g', {}, svg);
    for (const isl of this.world.islands) {
      const t = el('text', {
        x: isl.labelAt[0],
        y: isl.labelAt[1],
        class: 'isle-name',
        'text-anchor': 'middle',
      }, names);
      t.textContent = `${isl.name.toUpperCase()} · ${isl.bonus}`;
    }

    // ----- labels -----
    const labels = el('g', { 'pointer-events': 'none' }, svg);
    for (const c of this.world.countries) {
      const [x, y] = c.centroid;
      const num = el('text', { x, y: y - 7.5, class: 'c-num', 'text-anchor': 'middle' }, labels);
      num.textContent = String(c.id + 1);
      const count = el('text', { x, y: y + 7, class: 'c-count', 'text-anchor': 'middle' }, labels);
      count.textContent = '1';
      this.numEls[c.id] = num;
      this.countEls[c.id] = count;
    }

    // selection arrow
    this.arrowEl = el('g', { class: 'sel-arrow', visibility: 'hidden', 'pointer-events': 'none' }, svg);
    el('path', { d: 'M0 0 L-9 -16 L-3 -16 L-3 -30 L3 -30 L3 -16 L9 -16 Z', fill: '#ffe9a8', stroke: '#5b4a17', 'stroke-width': 1.2 }, this.arrowEl);

    this.fxLayer = el('g', { 'pointer-events': 'none' }, svg);
  }

  setPlayerColors(colors: string[]) {
    this.playerColors = colors;
  }

  refresh(st: GameState) {
    for (const c of this.world.countries) {
      const pEl = this.countryEls[c.id];
      pEl.style.fill = this.playerColors[st.owner[c.id]];
      const count = this.countEls[c.id];
      count.textContent = String(st.armies[c.id]);
      const prod = st.prodCenters.includes(c.id);
      count.classList.toggle('prod', prod);
      this.numEls[c.id].textContent = prod ? `⚓${c.id + 1}` : String(c.id + 1);
    }
  }

  setPickable(ids: number[]) {
    const set = new Set(ids);
    this.world.countries.forEach((c) => {
      this.countryEls[c.id].classList.toggle('pickable', set.has(c.id));
    });
  }

  arrow(id: number | null) {
    if (id === null) {
      this.arrowEl.setAttribute('visibility', 'hidden');
    } else {
      const [x, y] = this.world.countries[id].centroid;
      this.arrowEl.setAttribute('transform', `translate(${x} ${y - 10})`);
      this.arrowEl.setAttribute('visibility', 'visible');
    }
  }

  shake(ids: number[]) {
    for (const id of ids) {
      const elx = this.countryEls[id];
      elx.classList.remove('shaking');
      void elx.getBoundingClientRect();
      elx.classList.add('shaking');
    }
  }

  /** Pulse a bright, glowing outline in `color` over the given countries —
   *  used to call attention to disaster/event effects as they land. */
  flash(ids: number[], color = '#8fd0ff') {
    for (const id of ids) {
      const elx = this.countryEls[id];
      elx.style.setProperty('--flash', color);
      elx.classList.remove('flashing');
      void elx.getBoundingClientRect();
      elx.classList.add('flashing');
      setTimeout(() => elx.classList.remove('flashing'), 1300);
    }
  }

  floatText(id: number, text: string, color = '#fff') {
    const [x, y] = this.world.countries[id].centroid;
    const t = el('text', {
      x, y: y - 12,
      class: 'float-num',
      'text-anchor': 'middle',
      fill: color,
    }, this.fxLayer);
    t.textContent = text;
    setTimeout(() => t.remove(), 1700);
  }
}
