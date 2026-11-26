/**
 * match.js — recording-identity matcher: the judgement layer that decides whether
 * one catalogue's track is the same recording as another's.
 *
 * Both failure modes are silent:
 *  - Too loose  → the wrong recording plays under the right title (a cover, a
 *    remix, an hour-long loop) with nothing on screen to say so.
 *  - Too strict → the fallback catalogue is quietly never used, because the
 *    packaging in a YouTube title ("(From \"Satyamev Jayate\")") never meets
 *    the plain row the catalogue files the same audio under.
 *
 * The way out of both is to be explicit about what part of a title carries
 * identity. The title is taken apart into three pieces:
 *  - words:    the title proper. Must agree exactly (core match, romaji-bridged).
 *  - versions: words that mean *a different take* — remix, live, acoustic.
 *              Must agree exactly, in BOTH directions.
 *  - context:  everything else thrown away with the brackets. Never a veto,
 *              only a tie-break.
 * Artist and duration are then checked against that: a shared credit is
 * required when both sides name one (an exact runtime to the second may stand
 * in for it), and a runtime far from the one asked for rules a candidate out
 * however well its title reads.
 *
 * Shapes used here:
 *   target/candidate = { title, artist, durationSec|null, album|null,
 *                        isExplicit|null|undefined, isVideo? }
 */

/* ---------------- vocabulary ---------------- */

const BASE = 100;
const ARTIST_EXACT = 25;
const ARTIST_SHARED = 10;
/** A penalty, not a pass: any genuinely-credited candidate beats it by ≥25. */
const CREDITS_DISAGREE = -30;
/** How exactly two runtimes must agree to stand in for a shared credit. */
export const CREDIT_OVERRIDE_SEC = 2;
const DURATION_TIGHT = 40;
const DURATION_LOOSE = 15;
const ALBUM_EXACT = 35;
const EXPLICIT_EXACT = 20;
const CONTEXT_SHARED = 20;
/** Within this many seconds is the same master, allowing for trimmed silence. */
const DURATION_TIGHT_SEC = 3;
/** Past this, two tracks sharing a title are not sharing a recording. */
export const DURATION_LIMIT_SEC = 30;
/** Visual intros/outros can make a video substantially longer than its master. */
export const VIDEO_DURATION_LIMIT_SEC = 90;

const BRACKET_PASSES = 3;
const DASH_PASSES = 3;

const BRACKETED = /[(\[]([^()\[\]]*)[)\]]/g;
const DASH = /\s+[-–—|]+\s+/;
const FEATURING = /\b(feat|ft|featuring|with)\b.*/;
/** `~` and the wave dash join words in Japanese titles ("真夜中のドア〜stay"). */
const WORD_SPLIT = /[\s.·~〜]+/;
/**
 * Any language's letters, digits AND combining marks — ASCII-only emptied
 * every CJK/Devanagari title, and dropping the marks emptied Devanagari a
 * second time: the vowel signs (matras) are \p{M}, so "हिंदी" stripped down
 * to "हनद" and "तुम हिआ हो" to "तम ह हो". Two spellings of the same word
 * stopped looking alike, and every Hindi title stopped matching anything.
 */
const NON_ALNUM = /[^\p{L}\p{N}\p{M}]/gu;
const LATIN = /[a-z0-9]/;
const LATIN_QUERY_CHARS = /^[a-z0-9 ]+$/;
const CJK_OPEN = /[「『【〈《〔［｛]/g;
const CJK_CLOSE = /[」』】〉》〕］｝]/g;
// Not the katakana middle dot `・`: it sits *inside* a transliterated name
// (ジョン・レノン); splitting there makes two Johns one artist.
const ARTIST_SEPARATORS = /\s*(?:[,&/;·|、，×]|\band\b|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b)\s*/;
const CJK_PUNCT_STRIP = /[\s\p{P}\u30FB\uFF5E\u301C\u30FC-]+/gu;

/**
 * What makes a listing a different recording rather than a different listing
 * of the same one. A title carrying one of these on one side only is refused.
 */
const VERSION_WORDS = new Set([
  'remix', 'remixes', 'rmx', 'refix', 'flip', 'bootleg', 'mashup', 'medley',
  'live', 'concert', 'unplugged', 'acoustic', 'instrumental', 'karaoke',
  // A stem is not the song: "Vocals Only", "Acapella", "Backing Track" carry
  // the right title and artist and are not the recording anybody asked for.
  'vocals', 'vocal', 'acapella', 'acappella', 'backing', 'stems', 'stem',
  'cover', 'demo', 'reprise', 'remake', 'rework', 'extended', 'edit',
  'version', 'mix', 'dub', 'vip', 'session', 'sessions',
  'sped', 'slowed', 'reverb', 'nightcore', 'lofi', 'orchestral', 'symphonic',
  // A genre reworking is a different take, not the master.
  'synthwave', 'synth', 'cinematic', 'ambient', 'dubstep', 'spedup', 'sped',
  'reworked', 'reimagined', 'flip', 'bootleg', 'mashup', 'medley',
  'part', 'pt', 'chapter',
  // Non-Latin spellings of the same takes.
  'カバー', 'カラオケ', 'リミックス', 'ライブ', 'アコースティック',
  'インスト', 'バージョン', '歌ってみた', '踊ってみた', '弾いてみた',
  '翻唱', '现场', '混音',
  '커버', '라이브', '리믹스',
]);

/** VERSION_WORDS that are a take even printed bare at the end of a title. */
const TRAILING_TAKES = new Set([
  'instrumental', 'karaoke', 'acapella', 'acappella', 'remix', 'rmx', 'nightcore',
]);

/**
 * Takes whose absence from the audio is the point: a row filed under an album
 * declaring one of these *is* that take even when its own title says nothing.
 */
const NOVOCAL_TAKES = new Set([
  'instrumental', 'karaoke', 'acapella', 'acappella', 'backing', 'stems', 'stem',
]);

/** Asides that read like a version but describe the ordinary release. */
const NEUTRAL_SEGMENTS = new Set([
  'albumversion', 'originalversion', 'originalmix', 'singleversion',
  'radioversion', 'radioedit', 'stereoversion', 'monoversion',
  'studioversion', 'fullversion', 'standardversion', 'explicitversion',
  'deluxeversion', 'originaltrack',
]);

/** Packaging words, worth nothing as a tie-break because everything has them. */
const NOISE_WORDS = new Set([
  'official', 'video', 'audio', 'lyrics', 'lyric', 'lyrical', 'visualizer',
  'song', 'songs', 'full', 'music', 'the', 'and', 'from', 'feat', 'ft',
  'featuring', 'with', 'new', 'latest', 'free', 'download', 'remaster',
  'remastered', 'explicit', 'clean', 'bonus', 'track', 'deluxe', 'original',
  'album', 'single', 'hd', 'hq', '4k', 'mp3',
]);

const ALBUM_NOISE_WORDS = new Set([
  'album', 'deluxe', 'edition', 'expanded', 'remaster', 'remastered',
  'version', 'explicit', 'clean', 'bonus', 'anniversary',
]);

/** Trailing labels an upload hangs on a title with no brackets to hold them. */
const TRAILING_NOISE = new Set([
  'song', 'songs', 'video', 'audio', 'lyrics', 'lyric', 'lyrical',
  'official', 'full', 'hd', 'hq', '4k', 'mp3', 'ost', 'soundtrack',
]);

/** Dropped from the core so "Jack and Jill" and "Jack & Jill" are one title. */
const JOINING_WORDS = new Set(['and']);

/* ---------------- romaji (Hepburn) ---------------- */

function kanaRow(consonant, kana, vowels = 'aiueo') {
  const m = new Map();
  [...kana].forEach((k, i) => m.set(k, consonant + vowels[i]));
  return m;
}

const KANA_ROMAJI = new Map([
  ...kanaRow('', 'あいうえお'),
  ...kanaRow('k', 'かきくけこ'), ...kanaRow('g', 'がぎぐげご'),
  ...kanaRow('s', 'さしすせそ'), ['し', 'shi'],
  ...kanaRow('z', 'ざじずぜぞ'), ['じ', 'ji'],
  ...kanaRow('t', 'たちてと'), ['ち', 'chi'], ['つ', 'tsu'],
  ...kanaRow('d', 'だぢづでど'), ['ぢ', 'ji'], ['づ', 'zu'],
  ...kanaRow('n', 'なにぬねの'),
  ...kanaRow('h', 'はひふへほ'), ['ふ', 'fu'],
  ...kanaRow('b', 'ばびぶべぼ'), ...kanaRow('p', 'ぱぴぷぺぽ'),
  ...kanaRow('m', 'まみむめも'),
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ...kanaRow('r', 'らりるれろ'),
  ['わ', 'wa'], ['を', 'wo'], ['ん', 'n'],
  ['ゔ', 'vu'],
  ['ぁ', 'a'], ['ぃ', 'i'], ['ぅ', 'u'], ['ぇ', 'e'], ['ぉ', 'o'],
  ['ゃ', 'ya'], ['ゅ', 'yu'], ['ょ', 'yo'], ['ゎ', 'wa'],
  ['ヵ', 'ka'], ['ヶ', 'ke'],
]);
const SMALL_Y = new Map([['ゃ', 'ya'], ['ゅ', 'yu'], ['ょ', 'yo']]);
const SMALL_V = new Map([['ぁ', 'a'], ['ぃ', 'i'], ['ぅ', 'u'], ['ぇ', 'e'], ['ぉ', 'o']]);
const CONS_OVERRIDES = [
  ['shi', 'sh'], ['chi', 'ch'], ['tsu', 'ts'], ['fu', 'f'], ['ji', 'j'], ['zu', 'z'],
];

/**
 * Hepburn transliteration for kana; anything else passes through untouched.
 * Bridges コイコガレ/koikogare — but deliberately not kanji (no algorithmic
 * reading) nor English loans (ドア reads "doa", not "door").
 */
export function romajiOf(text) {
  let out = '';
  let i = 0;
  let geminate = false;
  let lastVowel = null;
  const emit = (roma) => {
    let r = roma;
    if (geminate) {
      geminate = false;
      r = r.startsWith('ch') ? `t${r}`
        : r.startsWith('sh') ? `s${r}`
        : r.startsWith('ts') ? `t${r}`
        : `${r[0]}${r}`;
    }
    out += r;
    const vs = [...r].filter((c) => 'aeiou'.includes(c));
    lastVowel = vs.length ? vs[vs.length - 1] : null;
  };
  while (i < text.length) {
    let c = text[i];
    // half-width katakana → full-width
    if (c >= 'ァ' && c <= 'ヶ') c = String.fromCharCode(c.charCodeAt(0) - 0x60);
    if (c === 'っ') { geminate = true; i++; continue; }
    if (c === 'ー') { if (lastVowel) out += lastVowel; i++; continue; }
    if (c === 'ん') {
      let nc = text[i + 1];
      if (nc && nc >= 'ァ' && nc <= 'ヶ') nc = String.fromCharCode(nc.charCodeAt(0) - 0x60);
      const first = nc ? (KANA_ROMAJI.get(nc) || '')[0] : undefined;
      emit(first === 'b' || first === 'm' || first === 'p' ? 'm' : 'n');
      i++;
      continue;
    }
    const base = KANA_ROMAJI.get(c);
    if (base == null) {
      out += c; lastVowel = null; geminate = false; i++;
      continue;
    }
    let n1 = text[i + 1];
    if (n1 && n1 >= 'ァ' && n1 <= 'ヶ') n1 = String.fromCharCode(n1.charCodeAt(0) - 0x60);
    const small = n1 ? (SMALL_Y.get(n1) || SMALL_V.get(n1)) : undefined;
    if (small) {
      const hit = CONS_OVERRIDES.find(([k]) => base.startsWith(k));
      const cons = hit ? hit[1] : base.slice(0, -1);
      // sh/ch/j already carry the glide: しゃ is "sha", ジャ is "ja".
      const glide = cons === 'sh' || cons === 'ch' || cons === 'j' ? small.replace(/^y/, '') : small;
      emit(cons + glide);
      i += 2;
    } else {
      emit(base);
      i++;
    }
  }
  return out;
}

/* ---------------- Indic (Devanagari) bridge ---------------- */

/**
 * Hindi songs are filed in two scripts: "तुम हिआ हो" and "Tum Hi Ho" are the
 * same recording, but a catalogue holds one of them and the search carries the
 * other, so the exact comparison refuses the pair and the song never matches
 * anything.
 *
 * A full romanisation is ambiguous — Hindi spelling rules would disagree with
 * themselves — but the *consonants* are not. "तुम हिआ हो" and "Tum Hi Ho" carry
 * the same consonants, and so does every other pair of spellings of one word.
 *
 * This can only ever ACCEPT a pair the exact comparison refused; it never
 * decides which candidate wins, and every other gate (version markers, the
 * artist credit, the runtime) still applies on top of it.
 */
const DEVANAGARI_RANGE = /[\u0900-\u097f]/;

/**
 * The Indic scripts, whose words are the filing in their own right (unlike
 * kanji, which is usually a transliteration shape).
 */
const INDIC_WORD =
  /[\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0a80-\u0aff\u0b00-\u0b7f\u0b80-\u0bff\u0c00-\u0c7f\u0c80-\u0cff\u0d00-\u0d7f\u0d80-\u0dff\u0e00-\u0e7f]/;

/** Devanagari consonants, in the naive Latin spelling a transliteration uses. */
const DEVANAGARI_CONSONANTS = new Map(
  Object.entries({
    क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng',
    च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'ny',
    ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
    त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
    प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
    य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
    ष: 'sh', स: 's', ह: 'h',
    ळ: 'l', क़: 'k', ख़: 'kh', ग़: 'g', ज़: 'z',
    ड़: 'd', ढ़: 'dh', फ़: 'f',
  }),
);

/** The consonants of a Devanagari string, romanised. */
function devanagariConsonants(text) {
  let out = '';
  for (const ch of text) {
    const c = DEVANAGARI_CONSONANTS.get(ch);
    if (c) out += c;
  }
  return out;
}

/**
 * The consonants of a Latin string. The vowels go, and so does `y`: in
 * Hindi transliteration it carries a vowel ("श्री" → "shay" → "sh"), and
 * Devanagari has no y consonant of its own.
 */
function latinConsonants(text) {
  return text.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiouy]/g, '');
}

/** How much two consonant sets agree, 0..1. */
function consonantAgreement(a, b) {
  const setA = new Set(a.replace(/[^a-z]/g, ''));
  const setB = new Set(b.replace(/[^a-z]/g, ''));
  if (setA.size < 4 || setB.size < 4) return 0;
  let shared = 0;
  for (const c of setA) if (setB.has(c)) shared++;
  return shared / Math.max(setA.size, setB.size);
}

/**
 * Whether two titles are the same words written in Devanagari and Latin.
 * Only one direction of the pair is Indic; two Latin titles are never
 * compared this way.
 */
function indicBridge(wanted, got) {
  const wDeva = DEVANAGARI_RANGE.test(wanted);
  const gDeva = DEVANAGARI_RANGE.test(got);
  if (wDeva === gDeva) return false;
  const [indic, latin] = wDeva ? [wanted, got] : [got, wanted];
  const a = devanagariConsonants(indic);
  const b = latinConsonants(latin);
  if (a.length < 4 || b.length < 4) return false;
  if (Math.max(a.length, b.length) > 2.2 * Math.min(a.length, b.length)) return false;
  return consonantAgreement(a, b) >= 0.85;
}

/* ---------------- normalization & title parsing ---------------- */

/**
 * NFKC + lowercase: full-width alphanumerics fold to ASCII, CJK brackets fold
 * to ASCII parens so the bracket pass handles 「title」 like (title). CJK
 * letters themselves survive — stripping them kept every non-Latin catalogue
 * out of matching entirely.
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(CJK_OPEN, '(')
    .replace(CJK_CLOSE, ')');
}

const wordsOf = (text) =>
  text.split(WORD_SPLIT).map((w) => w.replace(NON_ALNUM, '')).filter(Boolean);

const CJK_RE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF]/;

/**
 * Files one dropped segment under versions or context. A segment naming a take
 * is identity and is kept; everything else is packaging. NEUTRAL_SEGMENTS are
 * the exceptions that read like takes and aren't ("Album Version").
 */
function classify(segment, versions, context) {
  const words = wordsOf(segment);
  if (!words.length) return;
  if (NEUTRAL_SEGMENTS.has(words.join(''))) return;
  const marks = words.filter((w) => VERSION_WORDS.has(w));
  if (marks.length) {
    marks.forEach((m) => versions.add(m));
    return;
  }
  words.filter((w) => w.length > 2 && !NOISE_WORDS.has(w)).forEach((w) => context.add(w));
}

/** Whether `text` is nothing but (part of) `artist` — the "Artist - Title" shape. */
function isArtistName(text, artist) {
  if (!artist || !String(artist).trim()) return false;
  const words = wordsOf(text);
  if (!words.length) return false;
  const credited = new Set(wordsOf(normalize(artist)));
  return words.every((w) => credited.has(w));
}

/**
 * Words that actually file the track. A head holding nothing but a take
 * marker ("絆ノ奇跡 -instrumental-") carries no filing.
 *
 * Indic counts, and CJK deliberately does not: a Devanagari head IS the
 * filing ("श्री राम - Indian Classical Music" keeps its own title), while a
 * kanji head is the transliteration shape ("コイコガレ - koikogare"), where
 * the Latin tail is the filing.
 */
export function hasFilingWords(text) {
  return wordsOf(text).some(
    (w) => (LATIN.test(w) || INDIC_WORD.test(w)) && !VERSION_WORDS.has(w) && !NOISE_WORDS.has(w) &&
      !TRAILING_NOISE.has(w) && !JOINING_WORDS.has(w),
  );
}

/**
 * A title split into the part that is the recording's identity and the parts
 * that are the listing's: { words, core, versions:Set, context:Set }.
 */
export function parseTitle(raw, artist = '') {
  const versions = new Set();
  const context = new Set();
  let text = normalize(raw);

  // Bracketed asides, innermost first.
  for (let pass = 0; pass < BRACKET_PASSES; pass++) {
    if (!BRACKETED.test(text)) break;
    BRACKETED.lastIndex = 0;
    text = text.replace(BRACKETED, (_m, inner) => {
      classify(inner, versions, context);
      return ' ';
    });
  }
  // An unbalanced bracket — a title truncated mid-aside — takes the rest of
  // the line with it rather than leaving half an aside in the core.
  const open = [...text].findIndex((c) => c === '(' || c === '[');
  if (open >= 0) {
    classify(text.slice(open), versions, context);
    text = text.slice(0, open);
  }

  // Dash-/pipe-separated tails. The head is normally the title, but the
  // "Artist - Title" upload convention inverts that; a mixed-script head with
  // no filing Latin is the transliteration shape — the Latin tail becomes the
  // identity ("第ゼロ感 - Dai Zero Kan", "コイコガレ - koikogare").
  for (let pass = 0; pass < DASH_PASSES; pass++) {
    const m = DASH.exec(text);
    if (!m) break;
    const head = text.slice(0, m.index);
    const tail = text.slice(m.index + m[0].length);
    if (isArtistName(head, artist)) {
      classify(head, versions, context);
      text = tail;
    } else if (!hasFilingWords(head) && hasFilingWords(tail) && !isArtistName(tail, artist)) {
      // "紅蓮華 - LiSA" is the title and its artist, not a transliteration:
      // the Latin tail only takes over when it isn't just the credit.
      classify(head, versions, context);
      text = tail;
    } else {
      classify(tail, versions, context);
      text = head;
    }
  }

  // A feat. credit belongs to the artist field wherever it is printed.
  text = text.replace(FEATURING, ' ');

  // CJK languages do not use spaces between words: keep the raw character
  // sequence intact (stripping only punctuation and whitespace).
  const containsCJK = CJK_RE.test(text);

  let words = wordsOf(text).filter((w) => !JOINING_WORDS.has(w));
  // "Paniyon Sa Full Song", "Kizuna No Kiseki Instrumental" — trailing labels
  // with no brackets. Never stripped down to nothing: a track really called
  // "Song" keeps its name.
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (TRAILING_NOISE.has(last)) words = words.slice(0, -1);
    else if (TRAILING_TAKES.has(last)) { versions.add(last); words = words.slice(0, -1); }
    else break;
  }

  const core = containsCJK ? text.replace(CJK_PUNCT_STRIP, '') : words.join('');
  return { words, core, versions, context };
}

/** The title with the packaging taken off, version markers kept. */
export function searchableTitle(title, artist = '') {
  const p = parseTitle(title, artist);
  return [...p.words, ...p.versions].join(' ');
}

/** The first credited artist — who a catalogue is most likely to file under. */
export function primaryArtist(artist) {
  return (normalize(artist).split(ARTIST_SEPARATORS)[0] || '').trim();
}

/**
 * Both spellings when a dash joins the same word in two scripts
 * ("コイコガレ - koikogare", either order). Empty unless the two sides
 * transliterate to each other.
 */
export function scriptMates(raw) {
  const text = normalize(raw);
  const m = DASH.exec(text);
  if (!m) return [];
  const head = searchableTitle(text.slice(0, m.index));
  const tail = searchableTitle(text.slice(m.index + m[0].length));
  if (!head || !tail || head === tail) return [];
  if (romajiOf(head) === tail || romajiOf(tail) === head) return [head, tail];
  // "दिल माना - Dil Mana": two spellings of one title, so the catalogue gets
  // asked in the script it files things in.
  if (indicBridge(head, tail)) return [head, tail];
  return [];
}

/**
 * What to put to a source's search box, best query first. The raw title is
 * deliberately *not* one of them: a YouTube title carries the packaging, and
 * handing that verbatim to a catalogue that lists the track plainly is asking
 * it to match on words it has never stored.
 */
export function queries(target) {
  const title = searchableTitle(target.title, target.artist);
  if (!title.trim()) return [];
  const artist = primaryArtist(target.artist);
  const out = artist ? [`${title} ${artist}`, title] : [title];
  // The other script, asked once and without the artist.
  const latin = romajiOf(title).trim();
  const otherScript =
    (latin && latin !== title && LATIN_QUERY_CHARS.test(latin) ? latin : null) ||
    scriptMates(target.title).find((s) => s && s !== title) ||
    null;
  if (otherScript) out.push(otherScript);
  return [...new Set(out)];
}

/* ---------------- artist ---------------- */

/**
 * The credited artists, each as its own list of words — so containment is
 * checked on whole names: "Queen" is inside "Queensrÿche" as text and is not
 * one of its artists. Single letters go: "A. R. Rahman" ≡ "AR Rahman".
 */
export function artistNames(value) {
  return normalize(value)
    .split(ARTIST_SEPARATORS)
    .map((name) => wordsOf(name).filter((w) => w.length > 1))
    .filter((w) => w.length);
}

/** Whether [outer] contains [inner] as a run of whole words. */
function runOf(outer, inner) {
  if (!inner.length || inner.length > outer.length) return false;
  for (let at = 0; at + inner.length <= outer.length; at++) {
    if (inner.every((w, k) => outer[at + k] === w)) return true;
  }
  return false;
}

const sameArtist = (a, b) => runOf(a, b) || runOf(b, a);

/** Whether both credits name at least one of the same artists. */
export function sharesArtist(wanted, got) {
  const want = artistNames(wanted);
  const have = artistNames(got);
  return want.length > 0 && have.length > 0 && want.some((w) => have.some((h) => sameArtist(w, h)));
}

const nameKey = (sets) => sets.map((n) => n.join(' ')).sort().join('|');

/**
 * Points for the credit agreeing, or null when it disagrees. The disagreement
 * that matters is a cover: same title, different singer. The agreement that
 * has to survive is a *partial* credit ("Atif Aslam" vs "Atif Aslam, Tulsi
 * Kumar" are one recording with two spellings of its credit). A side with no
 * credit at all scores zero rather than failing.
 */
export function artistScore(wanted, got) {
  const want = artistNames(wanted);
  const have = artistNames(got);
  if (!want.length || !have.length) return 0;
  if (!sharesArtist(wanted, got)) return null;
  return nameKey(want) === nameKey(have) ? ARTIST_EXACT : ARTIST_SHARED;
}

/* ---------------- duration / album / explicit ---------------- */

/** "3:45" or "1:02:03" as whole seconds; null for anything else. */
export function secondsOf(text) {
  if (text == null) return null;
  const parts = String(text).trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p.trim())) return null;
    total = total * 60 + parseInt(p.trim(), 10);
  }
  return total > 0 ? total : null;
}

/**
 * Points for the runtimes agreeing, or null when too far apart to be the same
 * recording — the strongest signal, catching what titles cannot: the
 * ten-minute loop, the album-side upload, the snippet.
 */
function durationScore(wanted, got, allowVideoDrift = false) {
  if (wanted == null || got == null) return 0;
  const drift = Math.abs(wanted - got);
  if (drift > DURATION_LIMIT_SEC && allowVideoDrift && drift <= VIDEO_DURATION_LIMIT_SEC) return 0;
  if (drift > DURATION_LIMIT_SEC) return null;
  return drift <= DURATION_TIGHT_SEC ? DURATION_TIGHT : DURATION_LOOSE;
}

/** Punctuation, spacing and a trailing edition label are formatting, not identity. */
export function albumKey(value) {
  let text = normalize(value || '').trim();
  if (!text) return null;
  for (let pass = 0; pass < BRACKET_PASSES; pass++) text = text.replace(BRACKETED, ' ');
  const words = wordsOf(text).filter((w) => !ALBUM_NOISE_WORDS.has(w));
  const key = words.join('');
  return key || null;
}

/**
 * Exact release agreement is deliberately stronger than the difference between
 * a tight and a loose runtime. A disagreement is not a veto: compilations can
 * contain the same master.
 */
function albumScore(wanted, got) {
  const want = albumKey(wanted);
  const have = albumKey(got);
  if (!want || !have) return 0;
  return want === have ? ALBUM_EXACT : 0;
}

/** Clean and uncensored editions can be metadata-identical: when both state the flag they must agree. */
function explicitScore(wanted, got) {
  if (wanted == null || got == null) return 0;
  return wanted !== got ? null : EXPLICIT_EXACT;
}

/** Take markers carried by the release rather than the row. */
export function albumVersionMarkers(album) {
  return album ? parseTitle(album).versions : new Set();
}

/** A nudge when both listings mention the same film or album in their asides. */
function contextScore(wanted, got) {
  for (const c of wanted.context) if (got.context.has(c)) return CONTEXT_SHARED;
  return 0;
}

/* ---------------- judging ---------------- */

/** Whether two runtimes differ by more than the same-recording limit. */
export function isSevereMismatch(expectedSec, actualSec) {
  if (expectedSec == null || actualSec == null) return false;
  return Math.abs(actualSec - expectedSec) > DURATION_LIMIT_SEC;
}

/**
 * Disambiguates franchise sequels and parts (e.g. Awarapan 2 vs Awarapan, Hate Story 4 vs Hate Story).
 * Returns true if one is explicitly a numbered sequel/part and the other is a different number or unnumbered.
 */
export function areSequelClash(a, b) {
  if (!a || !b) return false;
  const sA = String(a).toLowerCase();
  const sB = String(b).toLowerCase();
  const numA = (sA.match(/\b(?:part|pt|vol|volume)?\s*([0-9]+|[ivx]+)\b/i) || [])[1];
  const numB = (sB.match(/\b(?:part|pt|vol|volume)?\s*([0-9]+|[ivx]+)\b/i) || [])[1];
  if (numA && numB && numA.toLowerCase() !== numB.toLowerCase()) return true;
  if ((numA && !numB) || (!numA && numB)) {
    const baseA = sA.replace(/\b(?:part|pt|vol|volume)?\s*([0-9]+|[ivx]+)\b/gi, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const baseB = sB.replace(/\b(?:part|pt|vol|volume)?\s*([0-9]+|[ivx]+)\b/gi, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (baseA && baseB && (baseA === baseB || (baseA.length >= 4 && baseB.length >= 4 && (baseA.includes(baseB) || baseB.includes(baseA))))) {
      return true;
    }
  }
  return false;
}

/** Both sides state a runtime and agree within `seconds`. */
export function withinSeconds(candidate, target, seconds) {
  const wanted = target.durationSec;
  if (wanted == null) return false;
  const got = candidate.durationSec;
  if (got == null) return false;
  return Math.abs(wanted - got) <= seconds;
}

/**
 * How confident this candidate is the same recording, or null when it is not.
 * Null is the common answer and the safe one.
 */
export function score(candidate, target) {
  if (target.album && candidate.album && areSequelClash(target.album, candidate.album)) {
    return null;
  }
  if (areSequelClash(target.title, candidate.title)) {
    return null;
  }

  const wanted = parseTitle(target.title, target.artist);
  const got = parseTitle(candidate.title, candidate.artist);
  if (!wanted.core || !got.core) return null;
  // Same word, different script: katakana コイコガレ vs romaji koikogare.
  // Past that, a guarded containment absorbs minor punctuation differences (<= 3 chars).
  const diffLen = Math.abs(wanted.core.length - got.core.length);
  const isTitleMatch =
    wanted.core === got.core ||
    romajiOf(wanted.core) === romajiOf(got.core) ||
    (wanted.core.length > 3 && got.core.length > 3 && diffLen <= 3 &&
      (wanted.core.includes(got.core) || got.core.includes(wanted.core))) ||
    // the same words in Devanagari and Latin (see the bridge above)
    indicBridge(wanted.core, got.core);
  // Sanitised names that are nearly the same string are the same title: a
  // stray mark or a spacing slip must not cost a perfect recording.
  const nearCore =
    !isTitleMatch &&
    wanted.core.length >= 5 &&
    got.core.length >= 5 &&
    proximity(wanted.core, got.core) >= 0.88;
  if (!isTitleMatch && !nearCore) return null;

  // Version markers must agree in both directions. Markers living on the
  // release come in two kinds: a wanted take found on the album completes the
  // row (one direction only); the no-vocal takes are bidirectional — a row
  // from an "INSTRUMENTAL EDITION" album *is* the instrumental even when its
  // title says nothing.
  const albumMarks = albumVersionMarkers(candidate.album);
  const effectiveVersions = new Set(got.versions);
  for (const m of albumMarks) if (NOVOCAL_TAKES.has(m) || wanted.versions.has(m)) effectiveVersions.add(m);
  if (wanted.versions.size !== effectiveVersions.size ||
      ![...wanted.versions].every((v) => effectiveVersions.has(v))) return null;

  const creditedArtist = artistScore(target.artist, candidate.artist);
  // A near-match is only believable when the credit agrees exactly. Two
  // nearly-alike titles by two different people are two different songs.
  if (nearCore && creditedArtist == null) return null;
  // A music video's drift is credible only when the row names the same artist.
  const duration = durationScore(target.durationSec, candidate.durationSec, creditedArtist != null);
  if (duration == null) return null;
  const artist =
    creditedArtist ??
    // Credits naming different people (Pritam wrote it, Neeraj Shridhar sang
    // it): an exact runtime to the second is allowed to stand in for a shared
    // credit — a cover or remix essentially never lands there. Never for a
    // video: visual intros make its runtime say nothing about the master.
    (!target.isVideo && withinSeconds(candidate, target, CREDIT_OVERRIDE_SEC) ? CREDITS_DISAGREE : null);
  if (artist == null) return null;
  const explicit = explicitScore(target.isExplicit ?? null, candidate.isExplicit ?? null);
  if (explicit == null) return null;
  // Duration is checked FIRST, and the penalty grows with the drift. A row
  // that runs minutes long is a medley or a compilation, whatever its title.
  const driftPenalty = durationPenalty(target.durationSec, candidate.durationSec, {
    isVideo: Boolean(target.isVideo || candidate.isVideo),
  });
  const isCompilationAlbum =
    candidate.album &&
    /\b(?:best\s+of|greatest\s+hits|essentials|anthology|top\s+hits|super\s*hits|evergreen|golden\s+hits|non[\s-]*stop|jukebox|collection)\b/i.test(
      candidate.album,
    ) &&
    !(target.album && /\b(?:best\s+of|greatest\s+hits|essentials|anthology|top\s+hits|super\s*hits|evergreen|golden\s+hits|non[\s-]*stop|jukebox|collection)\b/i.test(target.album));
  const compilationPenalty = isCompilationAlbum ? 35 : 0;
  return (
    BASE + artist + duration + albumScore(target.album, candidate.album) + explicit +
    contextScore(wanted, got) + officialWeight(candidate) - driftPenalty - compilationPenalty
  );
}

/**
 * Every candidate that really is the target, most confident first. A
 * runtime-identical cover is only a last-resort explanation: if anything
 * carries the requested artist, the different-artist rows leave contention.
 */
export function ranked(candidates, target) {
  const scored = [];
  for (const c of candidates) {
    // A bootleg, an AI cover, a speed-up: refused before anything else.
    if (isBlacklisted(c.title, c.channel, c.channelTitle, c.uploader)) continue;
    const s = score(c, target);
    if (s != null) scored.push([c, s]);
  }
  const credited = scored.filter(([c]) => artistScore(target.artist, c.artist) != null);
  const pool = credited.length ? credited : scored;
  return pool.sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** The best of the candidates that is genuinely the target, or null. */
export function best(candidates, target) {
  return ranked(candidates, target)[0] || null;
}

/**
 * The catalogue counterpart for a music-video upload selected explicitly: an
 * exact recording title, identical version markers and a shared artist are
 * enough; duration only ranks, never vetoes.
 */
export function bestOfficialAudioForVideo(candidates, target) {
  const wanted = parseTitle(target.title, target.artist);
  if (!wanted.core) return null;
  let top = null;
  let topScore = -Infinity;
  for (const candidate of candidates) {
    const got = parseTitle(candidate.title, candidate.artist);
    if (wanted.core !== got.core) continue;
    if (wanted.versions.size !== got.versions.size ||
        ![...wanted.versions].every((v) => got.versions.has(v))) continue;
    const artist = artistScore(target.artist, candidate.artist);
    if (artist == null) continue;
    const duration = target.durationSec != null
      ? (candidate.durationSec != null ? -Math.abs(target.durationSec - candidate.durationSec) : -120)
      : 0;
    const s = artist * 1000 + duration;
    if (s > topScore) { topScore = s; top = candidate; }
  }
  return top;
}

/**
 * Whether otherwise-valid rows describe more than one release while the
 * requested track gives us no release to choose with. JioSaavn has catalogue
 * collisions where title and artist are identical but the audio is not;
 * picking the runtime-nearest row is unsafe when a different recording can be
 * only a second nearer. Callers treat this as a conservative miss.
 */
export function hasConflictingAlbums(candidates, target) {
  if (target.album) return false;
  const comparable = target.durationSec != null
    ? candidates.filter((c) => withinSeconds(c, target, DURATION_LIMIT_SEC))
    : candidates;
  // No catalogue audio is within the normal window: the shape of an unlabelled
  // music video — release disagreement cannot be resolved from that runtime.
  if (target.durationSec != null && !comparable.length) return false;
  const keys = new Set();
  for (const c of comparable) {
    const k = albumKey(c.album);
    if (k) keys.add(k);
  }
  return keys.size > 1;
}

/**
 * Resolves a release collision only when one candidate is plainly more
 * specifically credited than every other close-duration candidate: a film's
 * original release names the whole vocal ensemble while compilation rows
 * reduce it. A single name cannot establish that; otherwise keep the fallback.
 */
export function uniquelyMostCreditedCloseMatch(candidates, target) {
  const close = candidates.filter((c) => withinSeconds(c, target, DURATION_LIMIT_SEC));
  if (close.length < 2) return null;
  const rank = close.map((c) => [c, artistNames(c.artist).length]);
  const topCredits = Math.max(...rank.map(([, n]) => n));
  if (topCredits < 2) return null;
  const winners = rank.filter(([, n]) => n === topCredits).map(([c]) => c);
  return winners.length === 1 ? winners[0] : null;
}

/** Yes-or-no convenience for callers that don't need the confidence. */
export function matches(candidate, title, artist, durationSec = null) {
  return score(candidate, { title, artist, durationSec }) != null;
}

/* ================================================================== *
 *  Platform-noise sanitation, string proximity, and source quality    *
 * ================================================================== *
 *
 * The matcher above decides whether two catalogue rows are the same
 * recording. The four things below decide whether a row is worth
 * comparing at all — and they are what stops a search result from
 * being a bootleg, an AI cover, or a 40-second speed-up edit.
 */

/**
 * Words that only ever describe the platform, never the recording.
 * A bracket holding nothing else is packaging and is taken off the title.
 */
const PLATFORM_WORDS = new Set([
  'official', 'video', 'audio', 'lyric', 'lyrics', 'lyrical', 'visualizer', 'visualiser',
  'hd', 'hq', '4k', 'full', 'song', 'songs', 'music', 'mv', 'teaser', 'trailer',
  'premiere', 'exclusive', 'new', 'out', 'now', 'release', 'trending', 'color', 'coded',
  'english', 'hindi', 'tamil', 'telugu', 'marathi', 'bengali', 'punjabi', 'kannada',
  'malayalam', 'gujarati', 'urdu', 'korean', 'japanese', 'chinese', 'arabic',
  'free', 'download', 'quality', 'remaster', 'remastered', 'version', 'single',
  'lyricvideo', 'officialvideo', 'officialaudio', 'fullsong', 'fullvideo', 'fullaudio',
]);

/** A view/play/like count, a bitrate, or a date — never identity. */
const METRIC_ASIDE = /^[\s\d.,]+\s*(?:[kmb]\+?)?\s*(?:views?|plays?|listeners?|subscribers?|likes?|fans?|kbps|mbps)?\s*$/i;

/** Whether a bracketed aside is the platform's own labelling. */
function isPackagingAside(inner) {
  const text = normalize(inner).trim();
  if (!text) return true;
  if (METRIC_ASIDE.test(text)) return true;
  const words = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.every(
    (w) => PLATFORM_WORDS.has(w) || NOISE_WORDS.has(w) || VERSION_WORDS.has(w) || /^\d/.test(w),
  );
}

/**
 * The title as two catalogues would both write it: no platform labels, no
 * film suffix, no feature credit, no view-count bracket.
 *
 * A file's packaging is not its identity. "(Official Video)" and
 * "(From \"Satyamev Jayate\")" describe where the recording was published,
 * not what it is — and a strict comparison read them as part of the title
 * and never matched anything.
 *
 * The original is returned when the stripping would empty the title: a
 * track really called "Video" keeps its name.
 */
export function sanitizeTitle(raw) {
  const original = String(raw ?? '');
  let text = normalize(original);

  // The film a song comes from: From "Satyamev Jayate" / from Satyamev Jayate.
  text = text.replace(/\bfrom\s+(?:"[^"]*"|'[^']*'|[^)\]|·]+)/gi, ' ');
  // A feature credit belongs to the artist field, never the title.
  text = text.replace(/\b(?:feat|ft|featuring)\b\.?\s+[^)\]|·]+/gi, ' ');
  // Bracketed platform labels and feature metrics.
  text = text.replace(/[\(\[]([^\)\]]*)[\)\]]/g, (whole, inner) => (isPackagingAside(inner) ? ' ' : whole));
  // A tail after a pipe or a dash that is only a platform label.
  text = text.replace(/[\s|]+(?:[\w\s]*\b)?(?:official\s+)?(?:music\s+)?(?:lyric\s*)?(?:videos?|audio|lyrics|visualizers?)\b[\s|]*$/i, ' ');

  text = text.replace(/\s{2,}/g, ' ').trim();
  return text || original;
}

/**
 * The artist as two catalogues would both write it. Only the platform's own
 * labelling comes off — the names themselves are identity and stay.
 */
export function sanitizeArtist(raw) {
  const original = String(raw ?? '');
  let text = normalize(original);
  text = text.replace(/[\(\[]([^\)\]]*)[\)\]]/g, (whole, inner) => (isPackagingAside(inner) ? ' ' : whole));
  text = text.replace(/[\s|]+(?:[\w\s]*\b)?(?:official\s+)?(?:music\s+)?(?:videos?|audio|lyrics|visualizers?)\b[\s|]*$/i, ' ');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text || original;
}

/* ---------------- string proximity (Levenshtein) ---------------- */

/** The edit distance between two strings. */
export function levenshtein(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  let cur = new Array(t.length + 1);
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur.slice();
  }
  return prev[t.length];
}

/** How alike two strings are, from 0 (nothing in common) to 1 (identical). */
export function proximity(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  const longest = Math.max(s.length, t.length);
  if (!longest) return 1;
  return 1 - levenshtein(s, t) / longest;
}

/* ---------------- duration-first validation ---------------- */

/** Past this, an audio candidate is a different recording, not the same one. */
export const AUDIO_DURATION_TOLERANCE_SEC = 5;
/** A music video runs long: a visual intro is not a different recording. */
export const VIDEO_DURATION_TOLERANCE_SEC = 35;

/**
 * The penalty for a candidate whose runtime disagrees with the source.
 *
 * Duration is checked FIRST, before any name comparison: a row that runs
 * 4 minutes longer than the track asked for is a medley, an extended mix
 * or a compilation, whatever its title says. The penalty grows with the
 * drift and is capped, so a wild candidate can never out-score a close one.
 */
export function durationPenalty(sourceSec, candidateSec, { isVideo = false } = {}) {
  if (sourceSec == null || candidateSec == null) return 0;
  const tolerance = isVideo ? VIDEO_DURATION_TOLERANCE_SEC : AUDIO_DURATION_TOLERANCE_SEC;
  const drift = Math.abs(sourceSec - candidateSec);
  if (drift <= tolerance) return 0;
  return Math.min(60, Math.round((drift - tolerance) / 2));
}

/* ---------------- rejection blacklist ---------------- */

/**
 * Low-effort content, refused outright. A bootleg remix, an AI cover, a
 * lo-fi edit, a speed-up, a fan compilation — none of these is the
 * recording the listener asked for, however exactly the title matches.
 */
export const REJECT_BLACKLIST = [
  /boot\s?leg/i,
  /\bai[\s._-]?(?:cover|version|song|generated|remix|made)/i,
  /\ba\.?i\.?\s+(?:cover|generated|version|song)/i,
  /\bgenerated\s+by\s+(?:ai|suno|udio)\b/i,
  /\b(?:suno|udio)\b/i,
  /\blo-?fi\s+(?:edit|remix|mix|version|cover)/i,
  /\bsped\s?up\b/i,
  /\bspeed\s?up\b/i,
  /\bslowed\s+and\s+reverb\b/i,
  /\bnightcore\b/i,
  /\b\d+d\s+audio\b/i,
  /\bfan\s+(?:compilation|made|made\s+compilation|mix)\b/i,
  /\bmegamix\b/i,
  /\bbutterfly\s+effect\b/i,
  /\bcover\s+band\b/i,
  /\btribute\s+(?:band|cover)\b/i,
  /\breverb\s+version\b/i,
  /\bvinyl\s+noise\s+version\b/i,
];

/** Whether a title or channel names content this build refuses to play. */
export function isBlacklisted(...texts) {
  for (const text of texts) {
    if (!text) continue;
    const value = String(text);
    if (REJECT_BLACKLIST.some((pattern) => pattern.test(value))) return true;
  }
  return false;
}

/* ---------------- official-source weighting ---------------- */

/** A VEVO channel: the label's own channel, the strongest signal there is. */
export const OFFICIAL_VEVO_WEIGHT = 45;
/** A verified artist channel or a badge the platform awarded. */
export const OFFICIAL_BADGE_WEIGHT = 30;
/** An "Official …" channel, or the auto-generated artist "Topic" channel. */
export const OFFICIAL_CHANNEL_WEIGHT = 18;

/**
 * How much a candidate's provenance is worth. Official sources are
 * preferred over an unknown upload carrying the same title — the platform's
 * own channels are the ones that hold the real recording.
 */
export function officialWeight(candidate) {
  if (!candidate) return 0;
  if (candidate.verified === true) return OFFICIAL_BADGE_WEIGHT;
  const channel = normalize(candidate.channel || candidate.channelTitle || candidate.uploader || '');
  if (!channel) return 0;
  if (channel.includes('vevo')) return OFFICIAL_VEVO_WEIGHT;
  if (/\bofficial\b/.test(channel)) return OFFICIAL_CHANNEL_WEIGHT;
  // YouTube Music's auto-generated artist channel: the catalogue's own audio.
  if (/\btopic\b/.test(channel)) return OFFICIAL_CHANNEL_WEIGHT;
  return 0;
}

