import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasRole } from "./lib/roles.js";

const MUSCLE_GROUP_VALIDATOR = v.union(
  v.literal("chest"),
  v.literal("back"),
  v.literal("shoulders"),
  v.literal("arms"),
  v.literal("legs"),
  v.literal("core"),
  v.literal("cardio"),
);

const PROGRAM_PHASE_VALIDATOR = v.union(
  v.literal("metabolic_rewire"),
  v.literal("anabolic_surge"),
  v.literal("body_recode"),
);

export const list = query({
  args: {
    muscleGroup: v.optional(MUSCLE_GROUP_VALIDATOR),
    programPhase: v.optional(PROGRAM_PHASE_VALIDATOR),
    searchTerm: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let exercises = await ctx.db.query("exercises").collect();

    if (args.muscleGroup) {
      exercises = exercises.filter((e) => e.muscleGroup === args.muscleGroup);
    }
    if (args.programPhase) {
      exercises = exercises.filter((e) => e.programPhase === args.programPhase);
    }
    if (args.searchTerm && args.searchTerm.length > 0) {
      const term = args.searchTerm.toLowerCase();
      exercises = exercises.filter(
        (e) =>
          e.name.toLowerCase().includes(term) ||
          e.description.toLowerCase().includes(term),
      );
    }

    // Resolve video URLs for exercises that have a storageId
    return Promise.all(
      exercises.map(async (e) => ({
        ...e,
        videoUrl: e.storageId ? await ctx.storage.getUrl(e.storageId) : e.videoUrl ?? null,
        // gifUrl is already stored on the document for WorkoutX exercises
      })),
    );
  },
});

export const get = query({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    const exercise = await ctx.db.get(args.id);
    if (!exercise) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Exercise not found" });
    }
    // Resolve storageId → temporary URL
    const videoUrl = exercise.storageId
      ? await ctx.storage.getUrl(exercise.storageId)
      : (exercise.videoUrl ?? null);
    return { ...exercise, videoUrl };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    storageId: v.optional(v.id("_storage")),
    muscleGroup: MUSCLE_GROUP_VALIDATOR,
    equipment: v.array(v.string()),
    primaryMuscles: v.array(v.string()),
    secondaryMuscles: v.array(v.string()),
    instructions: v.array(v.string()),
    cues: v.array(v.string()),
    safetyNotes: v.optional(v.string()),
    programPhase: v.optional(PROGRAM_PHASE_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can create exercises" });
    }

    return await ctx.db.insert("exercises", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("exercises"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    muscleGroup: v.optional(MUSCLE_GROUP_VALIDATOR),
    equipment: v.optional(v.array(v.string())),
    primaryMuscles: v.optional(v.array(v.string())),
    secondaryMuscles: v.optional(v.array(v.string())),
    instructions: v.optional(v.array(v.string())),
    cues: v.optional(v.array(v.string())),
    safetyNotes: v.optional(v.string()),
    programPhase: v.optional(PROGRAM_PHASE_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can update exercises" });
    }

    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

/** Remove only the video from an exercise (leaves all other data intact) */
export const removeVideo = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can remove videos" });
    }

    const exercise = await ctx.db.get(args.id);
    if (!exercise) throw new ConvexError({ code: "NOT_FOUND", message: "Exercise not found" });

    // Delete the stored file if present
    if (exercise.storageId) {
      await ctx.storage.delete(exercise.storageId);
    }

    await ctx.db.patch(args.id, { storageId: undefined, videoUrl: undefined });
  },
});

export const remove = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can delete exercises" });
    }

    const exercise = await ctx.db.get(args.id);
    if (exercise?.storageId) {
      await ctx.storage.delete(exercise.storageId);
    }

    await ctx.db.delete(args.id);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can upload videos" });
    }

    return await ctx.storage.generateUploadUrl();
  },
});
