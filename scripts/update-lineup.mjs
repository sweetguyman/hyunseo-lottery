// Fetches this month's Ichiban Kuji releases from 1kuji.com, translates them to Korean,
// and writes data/lineup.json for the 현서 제일 복권 site. Run by .github/workflows/update-lineup.yml.
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const BASE = 'https://1kuji.com';
const HEADERS = { 'user-agent': 'Mozilla/5.0 (hyunseo-lottery lineup updater)', 'accept-language': 'ja' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: HEADERS }); if (r.ok) return await r.text(); } catch (e) {}
    await sleep(1500);
  }
  throw new Error('fetch failed: ' + url);
}
const strip = s => String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

const jp2kr = s => String(s || '').replace(/■/g, '').replace(/全(\d+)種/, '전$1종').replace(/（選べない）/, ' (랜덤)').replace(/（選べる）/, ' (선택)')
  .replace(/サイズ：/, '크기 ').replace(/約/g, '약 ').replace(/本体/g, '본체').replace(/エフェクト込み/g, '이펙트 포함')
  .replace(/(\d+)枚セット/g, '$1장 세트').replace(/(\d+)体セット/g, '$1체 세트').replace(/、/g, ', ').trim();

function gradeKey(t) {
  t = t.trim();
  let m = t.match(/^([A-Z])\s*賞\s*(.*)$/); if (m) return { k: m[1], name: m[2].trim() };
  m = t.match(/^ラストワン賞\s*(.*)$/); if (m) return { k: 'LAST', name: m[1].trim() };
  return null;
}

function parseList(html, year, month) {
  const out = []; const seen = new Set();
  for (const m of html.matchAll(/<a href="\/products\/([\w-]+)">([\s\S]*?)<\/a>/g)) {
    const slug = m[1], body = m[2];
    if (seen.has(slug)) continue;
    const d = body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const name = strip((body.match(/<p class="itemName">([\s\S]*?)<\/p>/) || [])[1]);
    if (!d || !name) continue;
    if (+d[1] !== year || +d[2] !== month) continue;
    seen.add(slug);
    out.push({ slug, name, img: (body.match(/<img[^>]*src="([^"]+)"/) || [])[1] || '', y: +d[1], m: +d[2], d: +d[3] });
  }
  return out;
}

function parseProduct(html) {
  const title = strip((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).split('｜')[0].replace(/^一番くじ\s*/, '').trim();
  const heads = [];
  for (const m of html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)) heads.push({ t: strip(m[1]), i: m.index, e: m.index + m[0].length });
  const prizes = {};
  heads.forEach((h, n) => {
    const gk = gradeKey(h.t); if (!gk) return;
    const seg = html.slice(h.e, n + 1 < heads.length ? heads[n + 1].i : h.e + 20000);
    const p = prizes[gk.k] || (prizes[gk.k] = { name: gk.name, img: '', note: '' });
    if (!p.img) { const im = seg.match(/(https:\/\/assets\.1kuji\.com\/uploads\/product_item\/image\/[^"'\s)]+)/); if (im) p.img = im[1]; }
    if (!p.note) {
      const a = (seg.match(/■全[^<■]+/) || [''])[0], b = (seg.match(/■サイズ[^<■]+/) || [''])[0];
      p.note = [jp2kr(a), jp2kr(b)].filter(Boolean).join(' · ');
    }
  });
  return { title, prizes };
}

const GLOSS = [['転生したらスライムだった件', '전생했더니 슬라임이었던 건에 대하여'], ['くまのプーさん', '곰돌이 푸'], ['モンキー・D・ルフィ', '몽키 D. 루피'], ['ちょこっと', '초콧토'], ['モンスターズ・インク', '몬스터 주식회사'], ['リメンバー・ミー', '코코'], ['トイ・ストーリー', '토이 스토리'], ['桜蘭高校ホスト部', '오란고교 호스트부'], ['ウマ娘 プリティーダービー', '우마무스메 프리티 더비'], ['角都', '카쿠즈'], ['飛段', '히단'], ['お文具', '오분구'], ['ボンドルド', '본드루드'], ['マシュ・キリエライト', '마슈 키리에라이트'], ['アクリルスタンドキーホルダー', '아크릴 스탠드 키홀더'], ['アクリルチャーム', '아크릴 참'], ['チャーム', '참'], ['缶バッジ', '캔배지'], ['ラバーストラップ', '러버 스트랩'], ['ラバーマグネット', '러버 마그넷'], ['ラバーコースター', '러버 코스터'], ['アクリルスタンド', '아크릴 스탠드'], ['クリアファイル', '클리어 파일'], ['ハンドタオル', '핸드 타올'], ['タオル', '타올'], ['ぬいぐるみ', '인형'], ['フィギュア', '피규어'], ['色紙', '색지'], ['ちょこのっこ', '초코놋코'], ['リングストラップ', '링 스트랩'], ['ステッカー', '스티커'], ['マグカップ', '머그컵'], ['ポスター', '포스터'], ['一番くじちょこっと', '이치방쿠지 초콧토']];
const hasJa = s => /[぀-ヿ一-鿿]/.test(s || '');
const ENGINES = [
  async q => { const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ko&dt=t&q=' + encodeURIComponent(q), { headers: HEADERS });
    if (!r.ok) throw new Error('gtx ' + r.status); const j = await r.json(); return j[0].map(x => x[0]).join(''); },
  async q => { const r = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=ja&tl=ko&q=' + encodeURIComponent(q), { headers: HEADERS });
    if (!r.ok) throw new Error('dict ' + r.status); const j = await r.json(); const x = Array.isArray(j[0]) ? j[0][0] : j[0]; if (typeof x !== 'string') throw new Error('dict shape'); return x; },
  async q => { const r = await fetch('https://api.mymemory.translated.net/get?langpair=ja|ko&de=hyunseo.lottery@users.noreply.github.com&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('mymemory ' + r.status); const j = await r.json(); const x = j && j.responseData && j.responseData.translatedText;
    if (!x || /MYMEMORY WARNING|QUERY LENGTH/i.test(x)) throw new Error('mymemory ' + (j && j.responseStatus)); return x; },
];
let engine = 0;
async function gt(q) {
  for (let n = 0; n < ENGINES.length; n++) {
    const i = (engine + n) % ENGINES.length;
    try { const out = await ENGINES[i](q); engine = i; return out; } catch (e) { console.log('translate engine', i, 'failed:', e.message); }
  }
  throw new Error('all translators failed');
}
async function toKo(arr) {
  const src = arr.map(s => GLOSS.reduce((t, [a, b]) => t.split(a).join(b), String(s || '')));
  const idx = src.map((s, i) => hasJa(s) ? i : -1).filter(i => i >= 0); if (!idx.length) return src;
  try {
    const o = (await gt(idx.map(i => src[i]).join('\n'))).split('\n');
    if (o.length === idx.length) { idx.forEach((i, n) => src[i] = o[n].trim()); return src; }
  } catch (e) {}
  for (const i of idx) { try { src[i] = (await gt(src[i])).trim(); await sleep(300); } catch (e) {} }
  return src;
}

const now = new Date(Date.now() + 9 * 3600e3); // Japan/Korea time
const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1;
const listHtml = await get(BASE + '/products');
const list = parseList(listHtml, Y, M);
console.log(`found ${list.length} products released in ${Y}-${M}`);

const items = [];
for (const it of list) {
  try {
    const html = await get(`${BASE}/products/${it.slug}`);
    const p = parseProduct(html);
    const keys = Object.keys(p.prizes);
    if (!keys.length) { console.log('skip (no prizes):', it.slug); continue; }
    const title = p.title || it.name.replace(/^一番くじ\s*/, '');
    const ko = await toKo([title, ...keys.map(k => p.prizes[k].name), ...keys.map(k => p.prizes[k].note)]);
    const prizes = {};
    keys.forEach((k, i) => prizes[k] = { name: ko[1 + i], note: ko[1 + keys.length + i], img: p.prizes[k].img });
    items.push({ slug: it.slug, title: ko[0], titleJa: title, img: it.img, date: `${it.m}월 ${it.d}일 발매`, day: it.d, prizes });
    console.log('ok:', it.slug, '-', ko[0], `(${keys.length} prizes)`);
  } catch (e) { console.log('fail:', it.slug, e.message); }
  await sleep(800);
}
items.sort((a, b) => a.day - b.day);

const data = { updated: new Date().toISOString(), month: `${Y}-${String(M).padStart(2, '0')}`, label: `${M}월 발매`, items };
let prev = null;
try { prev = JSON.parse(await readFile('data/lineup.json', 'utf8')); } catch (e) {}
if (!items.length) { console.log('no lotteries found; keeping the previous file'); process.exit(0); }
if (prev && prev.month === data.month && JSON.stringify(prev.items) === JSON.stringify(items)) {
  console.log('lineup unchanged; nothing to write'); process.exit(0);
}
await mkdir('data', { recursive: true });
await writeFile('data/lineup.json', JSON.stringify(data, null, 1) + '\n');
console.log(`wrote data/lineup.json with ${items.length} lotteries`);
