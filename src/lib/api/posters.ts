import { getSettings } from '../storage';
import { apiRequest } from './http';
import type { ApiError, SearchType } from './types';

// Poster backfill over REST v1 (Ф6-27). GraphQL answers `poster: null` for part
// of the catalogue (every 18+ title checked, e.g. animes 1342/48755/50634), yet
// the very same titles carry an `image` in the REST index — so a page whose
// GraphQL posters came back empty is topped up here with ONE extra request.
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

// One request per page of results, never a request per title (CLAUDE.md rule 2).
// 50 is the documented cap of the REST v1 `limit`; our pages are 10 (search) and
// 30 (lists), so the cap is a guard, not a working limit.
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
    const wanted = [...new Set(ids)].filter((id) => /^[0-9]+$/.test(id)).slice(0, MAX_BATCH);
    if (wanted.length === 0) {
        return {};
    }
    // `limit` is mandatory: without it the endpoint answers with a SINGLE record
    // whatever the ids list (checked live 2026-07-28).
    const path = `${REST_PATHS[type]}?ids=${wanted.join(',')}&limit=${wanted.length}`;
    const result = await apiRequest<RestTitle[]>(path);
    if (!result.ok) {
        throw result.error satisfies ApiError;
    }
    if (!Array.isArray(result.data)) {
        return {};
    }
    const { origin } = await getSettings();
    const posters: Record<string, string> = {};
    for (const item of result.data) {
        const url = posterUrl(item, origin);
        if (url !== null) {
            posters[String(item.id)] = url;
        }
    }
    return posters;
}

// Relative path + origin from the settings (CLAUDE.md rule 4): the domain is
// never written out in code. An absolute https url is taken as is, in case the
// API ever starts returning one; anything else is dropped.
function posterUrl(item: RestTitle, origin: string): string | null {
    const path = item.image?.[POSTER_SIZE];
    if (typeof path !== 'string' || path === '' || path.startsWith(MISSING_PREFIX)) {
        return null;
    }
    if (path.startsWith('/')) {
        return `${origin}${path}`;
    }
    return path.startsWith('https://') ? path : null;
}
