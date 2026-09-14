import { defineServer } from '@notesgraph/plugin-sdk/server';

// Runs in the marketplace FaaS runtime; callable via ctx.backend.invoke('ping').
export default defineServer({
  functions: {
    ping: async (_req, ctx) => {
      const count = (((await ctx.kv.get('pings')) as number) ?? 0) + 1;
      await ctx.kv.set('pings', count);
      return { pong: true, count };
    },
  },
});
