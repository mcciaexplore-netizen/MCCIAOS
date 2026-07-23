import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

// CRUD over the generic `records` table. These are the only Convex functions
// the app calls; server/store.ts wraps them so the rest of the codebase keeps
// talking to the same synchronous-looking store interface.

export const listBySheet = query({
  args: { sheet: v.string() },
  handler: async (ctx, { sheet }) => {
    const rows = await ctx.db
      .query('records')
      .withIndex('by_sheet', (q) => q.eq('sheet', sheet))
      .collect();
    // Newest first, matching the file store's ordering.
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
});

export const getById = query({
  args: { id: v.id('records') },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const insert = mutation({
  args: {
    sheet: v.string(),
    data: v.any(),
    createdBy: v.union(v.string(), v.null()),
    assignedTo: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const id = await ctx.db.insert('records', { ...args, createdAt: now, updatedAt: now });
    return await ctx.db.get(id);
  },
});

export const patch = mutation({
  args: { id: v.id('records'), data: v.any() },
  handler: async (ctx, { id, data }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    const patched: Record<string, unknown> = {
      data: { ...row.data, ...data },
      updatedAt: new Date().toISOString(),
    };
    // assignedTo is promoted to a column, so keep it in sync when present.
    if (Object.prototype.hasOwnProperty.call(data, 'assignedTo')) {
      patched.assignedTo = data.assignedTo ?? null;
    }
    await ctx.db.patch(id, patched);
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id('records') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return false;
    await ctx.db.delete(id);
    return true;
  },
});
