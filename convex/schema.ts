import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Mirrors BACKEND_SCHEMA.md: one generic table with a `sheet` discriminator
// and an untyped `data` blob, so entity shapes stay defined in Zod
// (src/schemas) rather than being duplicated here.
export default defineSchema({
  records: defineTable({
    sheet: v.string(),
    assignedTo: v.union(v.string(), v.null()),
    createdBy: v.union(v.string(), v.null()),
    data: v.any(),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index('by_sheet', ['sheet']),
});
