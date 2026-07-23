import { getLocal } from '../storage';
import { authorizedRequest } from './auth';
import type { HttpResult } from './http';
import type { ApiError, RatePatch, RateTargetType, UserRateRef, UserRateStatus } from './types';

// REST v2 user_rates writes (docs/03-shikimori-api.md). Every write goes
// through authorizedRequest (401 -> one forced refresh -> one retry, docs/04
// §3.6) and never auto-retries on 429 — the http.ts default for non-GET.

const USER_RATES_PATH = '/api/v2/user_rates';

// Server response of create/update; only id + status are consumed here.
interface RestUserRate {
    id: number;
    status: UserRateStatus;
}

export async function createRate(
    targetId: string,
    targetType: RateTargetType,
    status: UserRateStatus,
): Promise<UserRateRef> {
    // GraphQL ID! is a numeric string; REST expects a number (docs/03).
    // Fail fast on a non-numeric id: NaN would serialize as target_id: null,
    // wasting a limiter slot on a guaranteed 422.
    const targetIdNumber = Number(targetId);
    if (!Number.isFinite(targetIdNumber)) {
        throw {
            kind: 'internal',
            message: `Non-numeric target id: "${targetId}"`,
        } satisfies ApiError;
    }
    // user_id comes from stored auth only, never from the message payload
    // (docs/02 protocol rules).
    const auth = await getLocal('auth');
    if (!auth) {
        throw { kind: 'unauthorized' } satisfies ApiError;
    }
    const result = await authorizedRequest<RestUserRate>(USER_RATES_PATH, {
        method: 'POST',
        body: {
            user_rate: {
                user_id: auth.user.id,
                target_id: targetIdNumber,
                target_type: targetType,
                status,
            },
        },
    });
    return toUserRateRef(unwrap(result));
}

export async function updateRate(rateId: string, patch: RatePatch): Promise<UserRateRef> {
    // RatePatch field names match the wire format 1:1 and undefined fields are
    // dropped by JSON.stringify, so the PATCH body stays partial as sent.
    const result = await authorizedRequest<RestUserRate>(`${USER_RATES_PATH}/${rateId}`, {
        method: 'PATCH',
        body: { user_rate: patch },
    });
    return toUserRateRef(unwrap(result));
}

export async function deleteRate(rateId: string): Promise<void> {
    // 404 passes through as { kind: 'api', status: 404 }: the record was
    // removed on the site; how to react is the UI's call (docs/03, Ф2-7).
    const result = await authorizedRequest<undefined>(`${USER_RATES_PATH}/${rateId}`, {
        method: 'DELETE',
    });
    unwrap(result);
}

function unwrap<T>(result: HttpResult<T>): T {
    if (!result.ok) {
        throw result.error;
    }
    return result.data;
}

function toUserRateRef(rate: RestUserRate): UserRateRef {
    return { id: String(rate.id), status: rate.status };
}
