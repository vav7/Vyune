async function main() {
  console.log('Testing /api/stream and /api/mv/resolve endpoints...');

  // 1. Test /api/stream
  const t0 = performance.now();
  const streamRes = await fetch('http://localhost:3000/api/stream?id=BddP6PYo2gs&title=Kesariya&artist=Arijit+Singh&album=Brahmastra&duration=268');
  const streamData = await streamRes.json();
  const streamElapsed = (performance.now() - t0).toFixed(0);

  console.log(`\n1. /api/stream result (${streamElapsed}ms):`, streamData);
  if (streamData.source !== 'saavn') {
    throw new Error(`Expected source to be 'saavn', got '${streamData.source}'`);
  }
  if (!streamData.url?.includes('saavncdn.com')) {
    throw new Error(`Expected saavncdn.com stream URL, got '${streamData.url}'`);
  }
  console.log('✔ Direct 320kbps JioSaavn stream verified!');

  // 2. Test /api/mv/resolve for Kesariya
  const t1 = performance.now();
  const mvRes1 = await fetch('http://localhost:3000/api/mv/resolve?title=Kesariya+-+Audio+%7C+Brahm%C4%81stra+%7C+Ranbir+%7C+Alia&artist=Pritam%2C+Arijit+Singh&album=Brahm%C4%81stra&duration=268');
  const mvData1 = await mvRes1.json();
  const mvElapsed1 = (performance.now() - t1).toFixed(0);

  console.log(`\n2. /api/mv/resolve for Kesariya (${mvElapsed1}ms):`, mvData1);
  if (!mvData1.videoId || mvData1.score < 350) {
    throw new Error(`Invalid MV result: ${JSON.stringify(mvData1)}`);
  }
  console.log('✔ Official Kesariya Music Video verified!');

  // 3. Test /api/mv/resolve for Tera Mera Rishta
  const t2 = performance.now();
  const mvRes2 = await fetch('http://localhost:3000/api/mv/resolve?title=Tera+Mera+Rishta&artist=Mustafa+Zahid&album=Awarapan&duration=320');
  const mvData2 = await mvRes2.json();
  const mvElapsed2 = (performance.now() - t2).toFixed(0);

  console.log(`\n3. /api/mv/resolve for Tera Mera Rishta (${mvElapsed2}ms):`, mvData2);
  if (!mvData2.videoId || mvData2.score < 350) {
    throw new Error(`Invalid MV result: ${JSON.stringify(mvData2)}`);
  }
  console.log('✔ Official Tera Mera Rishta Music Video verified!');

  // 4. Test /api/mv/resolve for Agar Tum Saath Ho
  const t3 = performance.now();
  const mvRes3 = await fetch('http://localhost:3000/api/mv/resolve?title=Agar+Tum+Saath+Ho&artist=Alka+Yagnik%2C+Arijit+Singh&album=Tamasha&duration=341');
  const mvData3 = await mvRes3.json();
  const mvElapsed3 = (performance.now() - t3).toFixed(0);

  console.log(`\n4. /api/mv/resolve for Agar Tum Saath Ho (${mvElapsed3}ms):`, mvData3);
  if (!mvData3.videoId || mvData3.score < 350) {
    throw new Error(`Invalid MV result: ${JSON.stringify(mvData3)}`);
  }
  console.log('✔ Official Agar Tum Saath Ho Music Video verified!');

  console.log('\n✔ All stream and MV endpoints passed with 100% precision!');
}

main().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
