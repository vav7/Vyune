import assert from 'node:assert/strict';
import { classifyRawRow, classifyRawTwoRow } from '../server/yt.js';

const endpoint = (pageType, browseId = 'catalogue-id') => ({
  browseEndpoint: { browseId },
  browseEndpointContextSupportedConfigs: {
    browseEndpointContextMusicConfig: { pageType },
  },
});

assert.equal(classifyRawRow({ navigationEndpoint: endpoint('MUSIC_PAGE_TYPE_ARTIST') }), 'artist');
assert.equal(classifyRawRow({ navigationEndpoint: endpoint('MUSIC_PAGE_TYPE_ALBUM') }), 'album');
assert.equal(classifyRawRow({ navigationEndpoint: endpoint('MUSIC_PAGE_TYPE_PLAYLIST') }), 'playlist');
assert.equal(classifyRawTwoRow({ title: { runs: [{ navigationEndpoint: endpoint('MUSIC_PAGE_TYPE_ARTIST') }] } }), 'artist');
assert.equal(classifyRawTwoRow({ title: { runs: [{ navigationEndpoint: endpoint('MUSIC_PAGE_TYPE_ALBUM') }] } }), 'album');
assert.equal(classifyRawTwoRow({ title: { runs: [{ navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'PL123' } } }] } }), 'playlist');

console.log('browse-kind: artist, album and playlist routes follow YouTube page metadata');
