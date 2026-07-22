import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { APP_NAME, ORIGINS } from '../config';

// Chrome replaces a custom User-Agent set on fetch() from the MV3 service
// worker with the browser one (verified 2026-07-22, docs/03), so the header is
// enforced by a declarativeNetRequest dynamic rule. http.ts keeps setting the
// header too — the rule simply overwrites it on the wire.

const UA_RULE_ID = 1;

export async function registerUserAgentRule(): Promise<void> {
    // http.ts refuses to fetch without APP_NAME, so a rule with an empty value
    // could only ever break the header — skip registration instead.
    if (!APP_NAME) {
        console.debug('[dnr] APP_NAME is not configured, User-Agent rule skipped');
        return;
    }
    const rule: Browser.declarativeNetRequest.Rule = {
        id: UA_RULE_ID,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'User-Agent', operation: 'set', value: APP_NAME }],
        },
        condition: {
            requestDomains: ORIGINS.map((origin) => new URL(origin).hostname),
            resourceTypes: ['xmlhttprequest'],
        },
    };
    try {
        // Fixed id + remove-first keeps the update idempotent across service
        // worker restarts.
        await browser.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [UA_RULE_ID],
            addRules: [rule],
        });
    } catch (e) {
        // A failed registration must not kill the service worker; requests then
        // go out with the browser UA, caught by the docs/03 manual checklist.
        console.debug('[dnr] failed to register the User-Agent rule:', e);
    }
}
