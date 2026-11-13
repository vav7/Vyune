/* search.test.mjs — the Search tab's parser, on a response shaped like YouTube
 * Music's: promoted card, mixed rows, videos kept out of the mixed page. */
import assert from 'node:assert/strict';
import { continuationToken, normalizeFilter, parseSearchPage, parseSearchSuggestions } from '../server/search.js';

const art = (w, h) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `https://lh3.googleusercontent.com/x=w${w}-h${h}`, width: w, height: h }] } } });
const runs = (...parts) => ({ runs: parts.map((p) => (typeof p === 'string' ? { text: p } : p)) });
const link = (text, browseId, pageType) => ({
  text,
  navigationEndpoint: { browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } },
});
const sep = ' • ';
const row = ({ videoId, browseId, pageType, title, byline, thumb = art(226, 226), explicit }) => ({
  musicResponsiveListItemRenderer: {
    ...(videoId ? { playlistItemData: { videoId } } : {}),
    ...(browseId ? { navigationEndpoint: { browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } } } : {}),
    thumbnail: thumb,
    badges: explicit ? [{ musicInlineBadgeRenderer: { icon: { iconType: 'MUSIC_EXPLICIT_BADGE' } } }] : [],
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: runs(title) } },
      { musicResponsiveListItemFlexColumnRenderer: { text: runs(...byline) } },
    ],
  },
});

const data = {
  contents: [
    {
      musicCardShelfRenderer: {
        title: runs('Blinding Lights'),
        subtitle: runs('Song', sep, link('The Weeknd', 'UCartist1', 'MUSIC_PAGE_TYPE_ARTIST'), sep, 'After Hours', sep, '3:22'),
        thumbnail: art(226, 226),
        onTap: { watchEndpoint: { videoId: 'top1' } },
      },
    },
    row({ videoId: 'song1', title: 'Save Your Tears', explicit: true, byline: ['Song', sep, link('The Weeknd', 'UCartist1', 'MUSIC_PAGE_TYPE_ARTIST'), sep, link('After Hours', 'MPREb_1', 'MUSIC_PAGE_TYPE_ALBUM'), sep, '3:35'] }),
    row({ videoId: 'vid1', title: 'Blinding Lights (Official Video)', thumb: art(544, 306), byline: ['Video', sep, 'TheWeekndVEVO', sep, '1.2B views', sep, '4:22'] }),
    row({ videoId: 'play-album', browseId: 'MPREb_2', pageType: 'MUSIC_PAGE_TYPE_ALBUM', title: 'After Hours', byline: ['Album', sep, link('The Weeknd', 'UCartist1', 'MUSIC_PAGE_TYPE_ARTIST'), sep, '2020'] }),
    row({ browseId: 'UCartist1', pageType: 'MUSIC_PAGE_TYPE_ARTIST', title: 'The Weeknd', byline: ['Artist', sep, '40M monthly audience'] }),
    row({ browseId: 'VLPL123', pageType: 'MUSIC_PAGE_TYPE_PLAYLIST', title: 'Weeknd Essentials', byline: ['Playlist', sep, 'YouTube Music'] }),
    row({ browseId: 'VLPL999', pageType: 'MUSIC_PAGE_TYPE_PLAYLIST', title: 'Daily Top Music Videos', byline: ['Playlist', sep, 'YouTube'] }),
    row({ videoId: 'song1', title: 'Save Your Tears', byline: ['Song', sep, 'The Weeknd', sep, '3:35'] }), // duplicate
    {
      continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'NEXT_TOKEN' } } },
    },
  ],
};

const all = parseSearchPage(data);
const kinds = all.rows.map((r) => `${r.kind}:${r.track?.id || r.item?.id}`);
assert.deepEqual(kinds, ['top:top1', 'track:song1', 'browse:MPREb_2', 'browse:UCartist1', 'browse:VLPL123'], kinds.join(','));
assert.equal(all.continuation, 'NEXT_TOKEN');
const song = all.rows[1].track;
assert.equal(song.explicit, true);
assert.equal(song.album, 'After Hours');
assert.equal(song.albumId, 'MPREb_1');
assert.deepEqual(song.artistIds, ['UCartist1']);
assert.equal(song.duration, 215);
assert.equal(song.isVideo, false);
assert.equal(all.rows[2].item.kind, 'album');
assert.equal(all.rows[3].item.kind, 'artist');
assert.equal(all.rows[4].item.kind, 'playlist');

// The Videos chip keeps only videos (and skips the promoted card).
const vids = parseSearchPage(data, { includeVideos: true });
assert.deepEqual(vids.rows.filter((r) => r.kind !== 'browse').map((r) => r.track.id), ['vid1']);
assert.equal(vids.rows.find((r) => r.track?.id === 'vid1').track.isUpload, true);

// Artist card: song rows with no credit borrow the card's artist.
const artistCard = {
  musicCardShelfRenderer: {
    title: runs('Daft Punk'),
    thumbnail: art(226, 226),
    onTap: { browseEndpoint: { browseId: 'UCdaft', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } },
    subtitle: runs('Artist', sep, '9M monthly audience'),
    contents: [row({ videoId: 'dp1', title: 'One More Time', byline: ['Song', sep, '5:20'] })],
  },
};
const withCard = parseSearchPage({ contents: [artistCard] });
assert.equal(withCard.rows[0].item.id, 'UCdaft');
assert.deepEqual(withCard.rows[1].track.artists, ['Daft Punk']);

// Continuation: the commandExecutor shape.
assert.equal(continuationToken({ continuationItemRenderer: { continuationEndpoint: { commandExecutorCommand: { commands: [{ continuationCommand: { token: 'T2' } }] } } } }), 'T2');
assert.equal(continuationToken({ x: 1 }), null);

assert.deepEqual(parseSearchSuggestions({ a: { searchSuggestionRenderer: { navigationEndpoint: { searchEndpoint: { query: 'blinding lights' } } } } }), ['blinding lights']);
assert.equal(normalizeFilter('Artists'), 'artists');
assert.equal(normalizeFilter('nonsense'), 'all');
console.log('search.test.mjs: ok');
