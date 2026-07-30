// Which `key` a production manifest gets — see wxt.config.ts, the only caller.
//
// Build-time code, not runtime: no entrypoint imports it, so it never reaches
// the bundle. It sits under src/ anyway because that is what `pnpm test`
// covers, and the rule it encodes is worth a test — a production build that
// quietly loses its key gets a different extension ID, and then every login
// fails against a redirect URI registered for the old one (docs/04 §1).

// The value that asks for a build without `key`, spelled out rather than left
// to an empty string: the Chrome Web Store hands out its own key on the first
// draft upload (docs/06, phase 9), and until then it is unknown whether the
// console accepts a package that already carries ours. Dropping the key has to
// be a deliberate act, because it changes the extension ID.
export const NO_MANIFEST_KEY = 'none';

export function manifestKeyField(raw: string | undefined): { key?: string } {
    const value = raw?.trim();
    if (!value) {
        throw new Error(
            'WXT_MANIFEST_KEY is not configured (see .env.example and README §3). ' +
                `Set it to the production public key, or to "${NO_MANIFEST_KEY}" ` +
                'to build without one — the store assigns a key on the first draft upload.',
        );
    }
    if (value === NO_MANIFEST_KEY) {
        console.warn(
            `WXT_MANIFEST_KEY=${NO_MANIFEST_KEY}: building without \`key\`. ` +
                'The extension ID will be derived from the install path, so the ' +
                'registered redirect URI will not match and login will fail.',
        );
        return {};
    }
    return { key: value };
}
