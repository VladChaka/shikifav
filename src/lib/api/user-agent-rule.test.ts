import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { APP_NAME } from '../config';
import { registerUserAgentRule } from './user-agent-rule';

describe('registerUserAgentRule', () => {
    // fakeBrowser ships declarativeNetRequest stubs that throw "not
    // implemented", so the call is mocked instead of exercised.
    const updateDynamicRules = vi.spyOn(fakeBrowser.declarativeNetRequest, 'updateDynamicRules');

    beforeEach(() => {
        fakeBrowser.reset();
        updateDynamicRules.mockReset();
        updateDynamicRules.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('replaces rule 1 with a modifyHeaders rule carrying APP_NAME for both domains', async () => {
        await registerUserAgentRule();

        expect(updateDynamicRules).toHaveBeenCalledTimes(1);
        const options = updateDynamicRules.mock.calls[0][0];
        expect(options.removeRuleIds).toEqual([1]);
        expect(options.addRules).toHaveLength(1);

        const rule = options.addRules?.[0];
        expect(rule).toMatchObject({
            id: 1,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{ header: 'User-Agent', operation: 'set', value: APP_NAME }],
            },
            condition: { resourceTypes: ['xmlhttprequest'] },
        });
        expect(rule?.condition.requestDomains).toHaveLength(2);
        expect(rule?.condition.requestDomains).toEqual(
            expect.arrayContaining(['shikimori.one', 'shikimori.io']),
        );
    });

    it('is idempotent: every call removes rule 1 before adding it back', async () => {
        await registerUserAgentRule();
        await registerUserAgentRule();

        expect(updateDynamicRules).toHaveBeenCalledTimes(2);
        for (const [options] of updateDynamicRules.mock.calls) {
            expect(options.removeRuleIds).toEqual([1]);
            expect(options.addRules?.map((rule) => rule.id)).toEqual([1]);
        }
    });

    it('logs via console.debug and does not throw when registration fails', async () => {
        updateDynamicRules.mockRejectedValueOnce(new Error('rules limit exceeded'));
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

        await expect(registerUserAgentRule()).resolves.toBeUndefined();

        expect(debugSpy).toHaveBeenCalledWith(
            '[dnr] failed to register the User-Agent rule:',
            expect.any(Error),
        );
        debugSpy.mockRestore();
    });

    it('skips registration when APP_NAME is empty', async () => {
        // Fresh module graph so config.ts re-reads the stubbed env.
        vi.stubEnv('WXT_SHIKI_APP_NAME', '');
        vi.resetModules();
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const fresh = await import('./user-agent-rule');

        await expect(fresh.registerUserAgentRule()).resolves.toBeUndefined();

        expect(updateDynamicRules).not.toHaveBeenCalled();
        expect(debugSpy).toHaveBeenCalledWith(
            '[dnr] APP_NAME is not configured, User-Agent rule skipped',
        );
        debugSpy.mockRestore();
    });
});
