import { httpsHref } from '../external-url';
import { getSettings } from '../storage';
import { apiRequest } from './http';
import type { ApiError, SearchType } from './types';

// Poster backfill over REST v1 (Ф6-27). GraphQL answers `poster: null` for part
// of the catalogue (every 18+ title checked, e.g. animes 1342/48755/50634), yet
// the very same titles carry an `image` in the REST index — so a page whose
// GraphQL posters came back empty is topped up here with one extra request per
// 50 ids (see MAX_BATCH).
// Reads stay GraphQL-first (CLAUDE.md rule 5): this is a fallback for a field
// GraphQL does not give, not a second read path.

// REST v1 index endpoints. Ranobe needs its own: /api/mangas?ids= silently
// drops light_novel/novel ids (checked live 2026-07-28 — id 81669 comes back
// from /api/ranobe and from /api/mangas/81669, but not from /api/mangas?ids=).
const REST_PATHS: Record<SearchType, string> = {
    anime: '/api/animes',
    manga: '/api/mangas',
    ranobe: '/api/ranobe',
};

// Ids per request, never a request per title (CLAUDE.md rule 2). 50 is the
// documented cap of the REST v1 `limit`, and since phase 7 a caller can hand
// over more than that: search asks for 10 ids and lists for 30 (one batch), but
// the calendar reads up to 150 rows at once. A longer list is therefore split
// into batches of 50 requested SEQUENTIALLY — dropping the tail would leave
// rows without a poster for no visible reason, and a parallel fan-out would
// burst the shared limiter.
const MAX_BATCH = 50;

// Which of the four `image` sizes to take (measured live 2026-07-28):
// x48 48x75, x96 96x150, preview 160x225, original 225x317. The card box is
// 60x94 and the row box 42x58, both at the 1:1.5625 aspect of x48/x96 (preview
// and original are 1:1.41 and would be cropped by object-fit). x48 would be
// upscaled in the card, so x96 it is — 7-9 KB per file, downscaled into both boxes.
const POSTER_SIZE = 'x96';

// The site serves this placeholder for a title with no poster at all
// (/assets/globals/missing_x96.jpg). Nothing to show — the caller falls through
// to the local fallback image instead.
const MISSING_PREFIX = '/assets/globals/';

// Wire shape of a REST v1 index item; only the two fields used here are typed.
// `image` paths are relative to the origin (e.g. "/system/animes/x96/1342.jpg?17…"),
// unlike the absolute urls GraphQL returns.
interface RestTitle {
    id: number;
    image: Partial<Record<typeof POSTER_SIZE, string>> | null;
}

// id -> absolute poster url, for the ids that have one. Ids the API does not
// know (or that have no poster) are simply absent from the map.
export async function fetchPosters(
    type: SearchType,
    ids: string[],
): Promise<Record<string, string>> {
    // Numeric-only and deduplicated: a junk id would poison the whole batch
    // request, and duplicates would waste its budget.
    const wanted = [...new Set(ids)].filter((id) => /^[0-9]+$/.test(id));
    if (wanted.length === 0) {
        return {};
    }
    const { origin } = await getSettings();
    const posters: Record<string, string> = {};
    for (let from = 0; from < wanted.length; from += MAX_BATCH) {
        const batch = wanted.slice(from, from + MAX_BATCH);
        // `limit` is mandatory: without it the endpoint answers with a SINGLE
        // record whatever the ids list (checked live 2026-07-28).
        const path = `${REST_PATHS[type]}?ids=${batch.join(',')}&limit=${batch.length}`;
        const result = await apiRequest<RestTitle[]>(path);
        if (!result.ok) {
            // Whatever the earlier batches gave stays: the backfill is not a user
            // action, and the caller turns a failure into "keep the fallback
            // image" (poster-backfill.ts), so half the posters beat none. With
            // nothing collected yet there is nothing to save — the error is
            // passed on, and the failure is still visible as ok:false on the wire.
            if (Object.keys(posters).length === 0) {
                throw result.error satisfies ApiError;
            }
            break;
        }
        // A non-array body is a malformed answer for this batch only.
        if (!Array.isArray(result.data)) {
            continue;
        }
        for (const item of result.data) {
            const url = posterUrl(item, origin);
            if (url !== null) {
                posters[String(item.id)] = url;
            }
        }
    }
    return posters;
}

// Relative path + origin from the settings (CLAUDE.md rule 4): the domain is
// never written out in code. An absolute url goes through the shared guard
// (src/lib/external-url.ts) instead of a second literal spelling of the same
// rule — this value ends up in an <img src>, which is exactly what that guard
// exists for; anything it refuses is dropped.
function posterUrl(item: RestTitle, origin: string): string | null {
    const path = item.image?.[POSTER_SIZE];
    if (typeof path !== 'string' || path === '' || path.startsWith(MISSING_PREFIX)) {
        return null;
    }
    if (path.startsWith('/')) {
        return `${origin}${path}`;
    }
    return httpsHref(path);
}
