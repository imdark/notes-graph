// Optional server bundle, run by the marketplace FaaS runtime. Plain ESM with a
// default export (a real plugin would `import { defineServer } from
// '@notesgraph/plugin-sdk/server'` for types). Callable from the client via
// `ctx.backend.invoke('greet', payload)`.
export default {
  functions: {
    greet: async (req, ctx) => {
      const count = ((await ctx.kv.get('greetCount')) ?? 0) + 1;
      await ctx.kv.set('greetCount', count);
      const name =
        (req.body && typeof req.body === 'object' && req.body.name) || 'world';
      ctx.log('greet called', name, count);
      return { message: `Hello, ${name}!`, serverCount: count };
    },
  },
};
