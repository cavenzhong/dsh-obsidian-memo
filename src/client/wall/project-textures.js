/** 项目纸纹：264 × 152 样本坐标；十二款原样本中的重色折角换成两款纯线稿。 */
const W = 264;
const H = 152;
const TAU = Math.PI * 2;

const motifs = [
  ['fiber', (g) => {
    for (let i=0;i<730;i++) {
      const x=g.r()*W, y=g.r()*H, l=0.4+g.r()*2.7;
      g.line(x,y,x+l,y+l*(g.r()-.67),.09+g.r()*.17,.63);
    }
    for(let i=0;i<110;i++) g.dot(g.r()*W,g.r()*H,.48,.16);
  }],
  ['weave', (g) => {
    for(let y=2;y<H;y+=3.8) for(let x=0;x<W;x+=5.4){
      const offset=(Math.floor(y/3.8)%2)*2;
      g.line(x+offset,y,x+offset+3,y,.14+g.r()*.10,.71);
      g.line(x+offset+3.55,y-1.35,x+offset+3.55,y+1.1,.085,.66);
    }
  }],
  ['pin-stars', (g) => {
    for(let y=8;y<H;y+=10.5) for(let x=6;x<W;x+=11.5){
      const px=x+(Math.round(y/10.5)%2)*5.75;
      if ((Math.round(x/11.5)+2*Math.round(y/10.5))%9===0) g.cross(px,y,1.7,.25,.72);
      else g.dot(px,y,.62,.19);
    }
  }],
  ['engineering-grid', (g) => {
    for(let x=12;x<W;x+=12) g.line(x,0,x,H,x%48===0?.19:.095,.66);
    for(let y=8;y<H;y+=12) g.line(0,y,W,y,(y-8)%48===0?.19:.095,.66);
    for(let x=48;x<W;x+=48) for(let y=8;y<H;y+=48) g.cross(x,y,2.3,.26,.84);
    g.line(12,143,72,143,.27,.8);
    for(let x=12;x<=72;x+=6) g.line(x,143,x,143-(x%12===0?3:1.5),.27,.72);
  }],
  ['ruled-paper', (g) => {
    g.line(21,0,21,H,.19,.8);
    g.line(24,0,24,H,.08,.62);
    for(let y=12;y<H;y+=10){
      g.line(28,y,W-8,y,(y-12)%50===0?.22:.135,.72);
      g.dot(14,y,(y-12)%30===0?1:.48,(y-12)%30===0?.26:.16);
    }
    g.line(W-36,145,W-8,145,.21,.85);
  }],
  ['bias', (g) => {
    for(let x=-170;x<W+20;x+=10){
      g.line(x,H,x+H*.83,0,.18,.79);
      g.line(x+1.65,H,x+1.65+H*.83,0,.073,.56);
    }
  }],
  ['topography', (g) => {
    for(let band=0;band<15;band++) g.curve((ctx)=>{
      for(let n=0;n<=132;n++){
        const a=n/132*TAU, radius=19+band*6.8+3*Math.sin(a*3+band*.14)+4.7*Math.sin(a*5+.4)+5*Math.cos(a*2);
        const x=226+radius*Math.cos(a)*1.37, y=117+radius*Math.sin(a)*.86;
        if(n===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath();
    },band%4===0?.27:.16,band%4===0?1:.68);
    g.cross(225,116,3.9,.27,.8);
  }],
  ['archive', (g) => {
    g.curve(ctx=>ctx.rect(6.5,6.5,W-13,H-13),.15,.7);
    for(const [x,y,dx,dy] of [[10,10,1,1],[W-10,10,-1,1],[10,H-10,1,-1],[W-10,H-10,-1,-1]]){
      g.curve(ctx=>{ctx.moveTo(x+dx*24,y);ctx.lineTo(x,y);ctx.lineTo(x,y+dy*16);},.26,1.22);
      g.dot(x+dx*3.5,y+dy*3.5,.9,.22);
    }
    for(let n=0;n<9;n++) g.line(W-12-4*n,H-12,W-12-4*n,H-(n%4===0?20:16),.23,.75);
  }],
  ['tide', (g) => {
    for(let y=-30;y<H+36;y+=6.6) g.curve(ctx=>{
      for(let x=0;x<=W;x+=2){
        const depth=(.08+(x/W)**2)*14;
        const yy=y+depth*Math.sin(x*.041+y*.044)+2.2*Math.sin(x*.018-y*.06);
        if(x===0) ctx.moveTo(x,yy); else ctx.lineTo(x,yy);
      }
    },Math.round(y/6.6)%5===0?.23:.145,.78);
  }],
  ['fold-parallel', (g) => {
    // Two groups, with clear space in between rather than shaded facets.
    for (const [x,y,a,w] of [
      [143,61,.28,1.04],[147.5,64.4,.16,.74],[154,69.3,.10,.68],
      [179,88.1,.25,1],[183.5,91.5,.16,.72],[190,96.4,.13,.7],[199,103.1,.09,.66],
    ]) veil(g,x,H,W,y,a,w);
    g.stroke(ctx=>{ctx.moveTo(245,11);ctx.lineTo(254,11);ctx.lineTo(254,30);},.115,.75);
    g.line(250,17,250,27,.085,.7);
  }],
  ['fold-hatch', (g) => {
    veil(g,143,H,W,61,.26,1.05);
    veil(g,149,H,W,65.5,.11,.73);
    veil(g,181,H,W,91,.22,.95);
    // Open hatch marks sit on one side of the crease without touching it.
    for (let i=0;i<12;i++) {
      const t = .13 + i*.067;
      const x = 181 + 83*t, y = H-61*t;
      const bloom = Math.sin(Math.PI*t);
      const len = 5+10*bloom + (i%3===1?2:0);
      veil(g,x+2,y+4+len,x+7,y+2,.10+.16*bloom,.76);
    }
    veil(g,217,H,W,117,.115,.76);
  }],
  ['isometric', (g) => {
    const pitch=12.1;
    for(let x=-H*1.75;x<W+H*1.75;x+=pitch*2){
      g.line(x,0,x+H*1.73,H,.11,.65);
      g.line(x,0,x-H*1.73,H,.11,.65);
    }
    for(let y=0;y<H;y+=pitch*.58) g.line(0,y,W,y,.09,.63);
    const x=220,y=103,d=24.2,k=13.95;
    g.curve(ctx=>{ctx.moveTo(x,y-k);ctx.lineTo(x+d,y);ctx.lineTo(x,y+k);ctx.lineTo(x-d,y);ctx.closePath();ctx.moveTo(x-d,y);ctx.lineTo(x-d,y+2*k);ctx.lineTo(x,y+3*k);ctx.lineTo(x+d,y+2*k);ctx.lineTo(x+d,y);ctx.moveTo(x,y+k);ctx.lineTo(x,y+3*k);},.31,.94);
  }],
  ['double-arc', (g) => {
    for(const [x,y,rs] of [[251,143,[22,28,44,50,68,86]],[248,142,[21,42,64]]])
      for(const r of rs) g.curve(ctx=>ctx.arc(x,y,r,Math.PI*1.01,TAU*.86),r%2===0?.22:.11,r%2===0?.85:.6);
    g.curve(ctx=>ctx.arc(233,141,105,Math.PI*1.10,Math.PI*1.86),.16,.74);
    g.cross(245,136,3.2,.29,.8);
  }],
];

function veil(g, x, y, ex, ey, alpha, width) {
  g.fadedLine(x, y, ex, ey, alpha, width);
}

const round = (n) => Math.round(n * 100) / 100;
const point = (x, y) => `${round(x)} ${round(y)}`;

// 把同笔宽／透明度的笔划合并成一个路径。SVG 只输出透明度，明暗由主题 CSS 提供。
function textureMask(draw, index) {
  const paths = new Map();
  const gradients = [];
  let seed = 192837 + index * 871;
  const add = (d, alpha, width) => {
    const paint = width == null
      ? `fill-opacity="${alpha}"`
      : typeof alpha === 'number'
        ? `fill="none" stroke="black" stroke-opacity="${alpha}" stroke-width="${width}"`
        : `fill="none" stroke="url(#${alpha})" stroke-width="${width}"`;
    if (!paths.has(paint)) paths.set(paint, []);
    paths.get(paint).push(d);
  };
  draw({
    r() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; },
    curve(path, alpha, width) {
      const commands = [];
      const move = (x, y) => commands.push(`M${point(x, y)}`);
      const line = (x, y) => commands.push(`L${point(x, y)}`);
      path({
        moveTo: move,
        lineTo: line,
        closePath() { commands.push('Z'); },
        rect(x, y, w, h) { move(x, y); line(x + w, y); line(x + w, y + h); line(x, y + h); commands.push('Z'); },
        arc(x, y, r, from, to) {
          move(x + r * Math.cos(from), y + r * Math.sin(from));
          commands.push(`A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(x + r * Math.cos(to), y + r * Math.sin(to))}`);
        },
      });
      add(commands.join(''), alpha, width);
    },
    line(x, y, ex, ey, alpha, width) { add(`M${point(x, y)}L${point(ex, ey)}`, round(alpha), width); },
    dot(x, y, r, alpha) {
      add(`M${point(x - r, y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`, alpha);
    },
    cross(x, y, r, alpha, width) {
      this.line(x - r, y, x + r, y, alpha, width);
      this.line(x, y - r, x, y + r, alpha, width);
    },
    fadedLine(x, y, ex, ey, alpha, width) {
      const id = `g${gradients.length}`;
      const stops = [[0, .27], [.23, 1], [.82, .9], [1, .58]]
        .map(([offset, factor]) => `<stop offset="${offset}" stop-opacity="${round(alpha * factor)}"/>`).join('');
      gradients.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(x)}" y1="${round(y)}" x2="${round(ex)}" y2="${round(ey)}">${stops}</linearGradient>`);
      add(`M${point(x, y)}L${point(ex, ey)}`, id, width);
    },
    stroke(path, alpha, width) { this.curve(path, alpha, width); },
  });
  const ink = Array.from(paths, ([paint, parts]) => `<path ${paint} d="${parts.join('')}"/>`).join('');
  // 与样本一致，从标题／正文所在的左上角逐渐淡出，不盖住文字。
  const fade = '<radialGradient id="soft" gradientUnits="userSpaceOnUse" fx="52" fy="44" cx="61" cy="48" r="132"><stop stop-color="white" stop-opacity=".18"/><stop offset=".56" stop-color="white" stop-opacity=".42"/><stop offset="1" stop-color="white"/></radialGradient>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${fade}<mask id="fade"><rect width="${W}" height="${H}" fill="url(#soft)"/></mask>${gradients.join('')}</defs><g mask="url(#fade)" stroke-linecap="round">${ink}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const PROJECT_TEXTURES = Object.freeze(motifs.map(([key, draw], index) => Object.freeze({ key, mask: textureMask(draw, index) })));

function projectTexture(meta) {
  const target = meta?.match?.(/\[\[([^|\]#]+)(?:[|#][^\]]*)?\]\]/u)?.[1]?.trim().replace(/\.md$/iu, '').normalize('NFC');
  if (!target) return undefined;
  let hash = 0;
  for (const ch of target) hash = (31 * hash + ch.codePointAt(0)) >>> 0;
  return PROJECT_TEXTURES[hash % PROJECT_TEXTURES.length].key;
}

export { PROJECT_TEXTURES, projectTexture };
