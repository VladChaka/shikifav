// Which name goes on the first row of a card/row (docs/05 «Options page»:
// Названия: «русские» / «ромадзи»). Kept as a plain literal union instead of an
// import from storage.ts: this module must stay free of chrome.* so it is
// testable (and tree-shakeable) on its own. A widened storage union would fail
// to compile at the call sites, which is the guard against drift.
export type TitleLang = 'ru' | 'romaji';

// Both TitleCard and RateRow carry exactly this pair (`name` is romaji and
// non-null per the GraphQL schema, docs/03).
export interface TitleNames {
    name: string;
    russian: string | null;
}

export interface DisplayTitle {
    primary: string;
    // Second, muted row; null means "nothing to show there".
    secondary: string | null;
}

// Picks the two rows of a title according to the setting. The empty-string
// guard matters: GraphQL returns `russian: ""` for some titles, and an empty
// first row would look like a broken card.
export function displayTitle(title: TitleNames, lang: TitleLang): DisplayTitle {
    const russian = title.russian ? title.russian : null;
    const primary = lang === 'romaji' ? title.name : (russian ?? title.name);
    const secondary = lang === 'romaji' ? russian : title.name;
    // Covers both "there is no other name" (the fallback put `name` on the
    // first row) and titles whose Russian name equals the romaji one.
    return { primary, secondary: secondary === primary ? null : secondary };
}
