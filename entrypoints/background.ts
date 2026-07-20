import { onMessage } from '@/src/lib/messaging';

export default defineBackground(() => {
    onMessage({
        ping: async () => ({ pong: true }),
    });
});
