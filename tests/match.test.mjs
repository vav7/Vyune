/* match.js smoke test — recording matcher scenarios. */
import assert from 'node:assert';
import {
  best, ranked, score, queries, searchableTitle, parseTitle, romajiOf, sharesArtist,
  hasConflictingAlbums, uniquelyMostCreditedCloseMatch, isSevereMismatch, secondsOf,
  bestOfficialAudioForVideo, withinSeconds,
} from '../server/match.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };
const T = (title, artist = '', durationSec = null, album = null, isExplicit = null, isVideo = false) =>
  ({ title, artist, durationSec, album, isExplicit, isVideo });
const C = T;

/* ---- the Paniyon Sa case: packaging in the title, partial credit ---- */
ok('Paniyon Sa (From "Satyamev Jayate") matches plain Atif Aslam, Tulsi Kumar row', () => {
  const target = T('Paniyon Sa (From "Satyamev Jayate")', 'Atif Aslam', 264);
  const cand = C('Paniyon Sa', 'Atif Aslam, Tulsi Kumar', 264, 'Satyamev Jayate');
  assert.ok(score(cand, target) != null);
  assert.equal(best([cand], target), cand);
});
ok('searchableTitle strips packaging, keeps version markers', () => {
  assert.equal(searchableTitle('Paniyon Sa Full Song'), 'paniyon sa');
  assert.equal(searchableTitle('Paniyon Sa (From "Satyamev Jayate")'), 'paniyon sa');
  assert.equal(searchableTitle('Kizuna No Kiseki Instrumental'), 'kizuna no kiseki instrumental');
});

/* ---- versions are identity, in BOTH directions ---- */
ok('live take ≠ studio cut (both directions)', () => {
  assert.equal(score(C('Song (Live at Wembley)', 'X', 200), T('Song', 'X', 200)), null);
  assert.equal(score(C('Song', 'X', 200), T('Song (Live at Wembley)', 'X', 200)), null);
});
ok('karaoke/cover/instrumental twins refused', () => {
  assert.equal(score(C('Kesariya (Karaoke)', 'Arijit Singh', 268), T('Kesariya', 'Arijit Singh', 268)), null);
  assert.equal(score(C('Kesariya', 'Arijit Singh', 268), T('Kesariya (Karaoke)', 'Arijit Singh', 268)), null);
  // the album-declared instrumental twin: same title, same runtime, album says instrumental
  const twin = C('Am I Dreaming', 'Metro Boomin', 256, 'Am I Dreaming (Metroverse Instrumental Edition)');
  assert.equal(score(twin, T('Am I Dreaming', 'Metro Boomin', 256, 'Metroverse')), null);
});
ok('neutral segments do not split one recording', () => {
  assert.ok(score(C('Song (Album Version)', 'X', 200), T('Song', 'X', 200)) != null);
  assert.ok(score(C('Song (Radio Edit)', 'X', 200), T('Song', 'X', 200)) != null);
});
ok('a wanted take found on the album completes the row (one direction)', () => {
  const row = C('KALYANI', 'Hiphop Tamizha', 210, 'KALYANI (Remix)');
  assert.ok(score(row, T('KALYANI (Remix)', 'Hiphop Tamizha', 210)) != null);
  // the album's remix naming is release packaging: it cannot veto the plain
  // row either (only wanted markers come off the album)
  assert.ok(score(row, T('KALYANI', 'Hiphop Tamizha', 210)) != null);
});

/* ---- the Jhak Maar Ke case: composer vs singer credits ---- */
ok('exact runtime stands in for disagreeing credits (Pritam wrote, Neeraj sang)', () => {
  const target = T('Jhak Maar Ke', 'Neeraj Shridhar', 233);
  const right = C('Jhak Maar Ke', 'Pritam', 233);
  const remix = C('Jhak Maar Ke (Remix)', 'Pritam', 241);
  const cover = C('Jhak Maar Ke', 'Some Cover Band', 66);
  assert.ok(score(right, target) != null);
  assert.equal(score(remix, target), null); // version mismatch
  assert.equal(score(cover, target), null); // runtime too far, credits disagree
});
ok('a properly-credited copy always outranks a runtime-vouched one', () => {
  const target = T('Song', 'Singer A', 200);
  const credited = C('Song', 'Singer A', 201);
  const vouched = C('Song', 'Composer B', 200);
  assert.equal(ranked([vouched, credited], target)[0], credited);
});
ok('no runtime on either side + different credits = refusal', () => {
  assert.equal(score(C('Song', 'Someone Else'), T('Song', 'Singer A')), null);
});

/* ---- the Brown Rang video case ---- */
ok('a video runtime cannot vouch for a different-artist row (Lovely 3:30 vs Brown Rang 3:31)', () => {
  const video = T('Brown Rang', 'Yo Yo Honey Singh', 211, null, null, true);
  const impostor = C('Brown Rang', 'Different Guy', 210);
  assert.equal(score(impostor, video), null);
  // same artist, long visual intro: allowed within the 90s video drift
  assert.ok(score(C('Brown Rang', 'Yo Yo Honey Singh', 260), video) != null);
});
ok('bestOfficialAudioForVideo: exact title + versions + shared artist, duration only ranks', () => {
  const video = T('Brown Rang (Official Video)', 'Yo Yo Honey Singh', 211, null, null, true);
  const single = C('Brown Rang', 'Yo Yo Honey Singh', 195, 'International Villager');
  const live = C('Brown Rang (Live)', 'Yo Yo Honey Singh', 240);
  const cover = C('Brown Rang', 'Tribute Band', 195);
  assert.equal(bestOfficialAudioForVideo([live, cover, single], video), single);
});

/* ---- duration vetoes ---- */
ok('duration semantics: drift ≤90s scored 0 with a shared credit; >90s veto; disagreeing credits need ±2s', () => {
  assert.equal(score(C('Song', 'X', 600), T('Song', 'X', 200)), null); // hour-long loop
  assert.ok(score(C('Song', 'X', 210), T('Song', 'X', 200)) != null); // 10s: loose but valid
  // same credit, 31s drift = plausible video intro → kept, but with zero duration points
  const drifted = score(C('Song', 'X', 231), T('Song', 'X', 200));
  assert.ok(drifted != null && drifted < score(C('Song', 'X', 210), T('Song', 'X', 200)));
  // different credits: only an exact runtime (±2s) can vouch
  assert.equal(score(C('Song', 'Someone Else', 210), T('Song', 'Real Singer', 200)), null);
  assert.ok(score(C('Song', 'Someone Else', 201), T('Song', 'Real Singer', 200)) != null);
  assert.ok(score(C('Song', 'X', 202), T('Song', 'X', 200)) > score(C('Song', 'X', 210), T('Song', 'X', 200)));
  assert.ok(isSevereMismatch(302, 209));
  assert.ok(!isSevereMismatch(302, 300));
  assert.ok(!isSevereMismatch(302, null));
  assert.equal(secondsOf('3:45'), 225);
  assert.equal(secondsOf('1:02:03'), 3723);
  assert.equal(secondsOf('nonsense'), null);
});

/* ---- artists ---- */
ok('partial credits agree; covers do not; whole names only', () => {
  assert.ok(sharesArtist('Atif Aslam', 'Atif Aslam, Tulsi Kumar'));
  assert.ok(!sharesArtist('Queen', 'Queensrÿche'));
  assert.ok(sharesArtist('A. R. Rahman', 'AR Rahman'));
  assert.ok(sharesArtist('Sonu Nigam', 'Sonu Nigam')); // identical
  assert.ok(!sharesArtist('Arijit Singh', 'Amrit Maan'));
});
ok('a side with no credit scores zero, not failure', () => {
  assert.ok(score(C('Song', '', 200), T('Song', 'X', 200)) != null);
});

/* ---- explicit flag ---- */
ok('clean and uncensored editions cannot stand in for each other', () => {
  assert.equal(score(C('Song', 'X', 200, null, false), T('Song', 'X', 200, null, true)), null);
  assert.ok(score(C('Song', 'X', 200, null, true), T('Song', 'X', 200, null, true)) != null);
  assert.ok(score(C('Song', 'X', 200, null, null), T('Song', 'X', 200, null, true)) != null);
});

/* ---- scripts ---- */
ok('romaji bridges kana in both identity and queries', () => {
  assert.equal(romajiOf('コイコガレ'), 'koikogare');
  assert.equal(romajiOf('しゃしん'), 'shashin');
  assert.equal(romajiOf('がっこう'), 'gakkou');
  assert.equal(romajiOf('レンアイ'), 'renai');
  assert.ok(score(C('Koi Kogare', 'Omoinotake', 250), T('コイコガレ', 'Omoinotake', 250)) != null);
  const qs = queries(T('コイコガレ', 'Omoinotake'));
  assert.ok(qs.some((q) => q === 'koikogare'), JSON.stringify(qs));
});
ok('Artist - Title and transliteration dash shapes both land on the title', () => {
  assert.equal(parseTitle('紅蓮華 - LiSA', 'LiSA').core, '紅蓮華');
  assert.equal(parseTitle('コイコガレ - koikogare', 'Omoinotake').core, 'koikogare');
  assert.equal(parseTitle('第ゼロ感 - Dai Zero Kan', '').core, 'daizerokan');
});
ok('CJK/Devanagari titles survive normalization (never empty cores)', () => {
  assert.ok(parseTitle(' kesariya ').core.length > 0);
  assert.ok(parseTitle('मैं हूँ हीरो').core.length > 0);
  assert.ok(parseTitle('紅蓮華').core.length > 0);
});
ok('queries: never the raw decorated title first', () => {
  const qs = queries(T('Paniyon Sa (From "Satyamev Jayate") [Official Video]', 'Atif Aslam, Tulsi Kumar'));
  assert.equal(qs[0], 'paniyon sa atif aslam');
  assert.equal(qs[1], 'paniyon sa');
});

/* ---- JioSaavn catalogue collisions ---- */
ok('conflicting albums: refuse to guess, unless one row is uniquely most credited', () => {
  const target = T('Brown Rang', 'Yo Yo Honey Singh', 211);
  const a = C('Brown Rang', 'Yo Yo Honey Singh', 210, 'International Villager');
  const b = C('Brown Rang', 'Yo Yo Honey Singh', 212, 'Best of Honey Singh');
  assert.ok(hasConflictingAlbums([a, b], target));
  assert.equal(uniquelyMostCreditedCloseMatch([a, b], target), null); // equal single credits
  const fuller = C('Brown Rang', 'Yo Yo Honey Singh, Lil Golu', 211, 'International Villager');
  const comp = C('Brown Rang', 'Yo Yo Honey Singh', 212, 'Best of Honey Singh');
  assert.equal(uniquelyMostCreditedCloseMatch([fuller, comp], target), fuller);
  // a target that knows its album has nothing to resolve
  assert.ok(!hasConflictingAlbums([a, b], T('Brown Rang', 'Yo Yo Honey Singh', 211, 'International Villager')));
});

/* ---- album + context bonuses ---- */
ok('known album beats a one-second-closer different release', () => {
  const target = T('Song', 'X', 200, 'Album One');
  const rightAlbum = C('Song', 'X', 205, 'Album One');
  const wrongAlbum = C('Song', 'X', 201, 'Greatest Hits');
  assert.equal(ranked([wrongAlbum, rightAlbum], target)[0], rightAlbum);
});
ok('shared film context breaks title ties', () => {
  const target = T('Tum Hi Ho (From Aashiqui 2)', 'Arijit Singh', 262);
  const withContext = C('Tum Hi Ho', 'Arijit Singh', 262, 'Aashiqui 2');
  const without = C('Tum Hi Ho', 'Arijit Singh', 266);
  assert.ok(score(withContext, target) >= score(without, target));
});
ok('withinSeconds requires BOTH runtimes (unstated is not a near miss)', () => {
  assert.ok(!withinSeconds(C('Song', 'X'), T('Song', 'X', 200), 2));
  assert.ok(withinSeconds(C('Song', 'X', 201), T('Song', 'X', 200), 2));
});

console.log(`\nmatch.js: ${n} assertions groups passed`);
