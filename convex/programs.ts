import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    phase: v.optional(v.union(
      v.literal("metabolic_rewire"),
      v.literal("anabolic_surge"),
      v.literal("body_recode")
    )),
    difficulty: v.optional(v.union(
      v.literal("beginner"),
      v.literal("intermediate"),
      v.literal("advanced")
    )),
  },
  handler: async (ctx, args) => {
    let programs;

    if (args.phase) {
      programs = await ctx.db
        .query("programs")
        .withIndex("by_phase", (q) => q.eq("phase", args.phase!))
        .collect();
    } else {
      programs = await ctx.db.query("programs").collect();
    }

    if (args.difficulty) {
      programs = programs.filter(p => p.difficulty === args.difficulty);
    }

    // Get creator info for each program
    const programsWithCreators = await Promise.all(
      programs.map(async (program) => {
        const creator = await ctx.db.get(program.createdBy);
        return {
          ...program,
          creatorName: creator?.name || "Unknown",
        };
      })
    );

    return programsWithCreators;
  },
});

export const get = query({
  args: { id: v.id("programs") },
  handler: async (ctx, args) => {
    const program = await ctx.db.get(args.id);
    if (!program) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Program not found",
      });
    }

    const creator = await ctx.db.get(program.createdBy);
    
    return {
      ...program,
      creatorName: creator?.name || "Unknown",
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    phase: v.union(
      v.literal("metabolic_rewire"),
      v.literal("anabolic_surge"),
      v.literal("body_recode")
    ),
    durationWeeks: v.number(),
    difficulty: v.union(
      v.literal("beginner"),
      v.literal("intermediate"),
      v.literal("advanced")
    ),
    goals: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user || (user.role !== "coach" && user.role !== "admin")) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only coaches and admins can create programs",
      });
    }

    return await ctx.db.insert("programs", {
      ...args,
      createdBy: user._id,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("programs"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    phase: v.optional(v.union(
      v.literal("metabolic_rewire"),
      v.literal("anabolic_surge"),
      v.literal("body_recode")
    )),
    durationWeeks: v.optional(v.number()),
    difficulty: v.optional(v.union(
      v.literal("beginner"),
      v.literal("intermediate"),
      v.literal("advanced")
    )),
    goals: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user || (user.role !== "coach" && user.role !== "admin")) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only coaches and admins can update programs",
      });
    }

    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("programs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user || (user.role !== "coach" && user.role !== "admin")) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only coaches and admins can delete programs",
      });
    }

    await ctx.db.delete(args.id);
  },
});

export const duplicate = mutation({
  args: { id: v.id("programs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user || (user.role !== "coach" && user.role !== "admin")) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only coaches and admins can duplicate programs",
      });
    }

    const originalProgram = await ctx.db.get(args.id);
    if (!originalProgram) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Program not found",
      });
    }

    // Create duplicate program
    const newProgramId = await ctx.db.insert("programs", {
      name: `${originalProgram.name} (Copy)`,
      description: originalProgram.description,
      phase: originalProgram.phase,
      durationWeeks: originalProgram.durationWeeks,
      difficulty: originalProgram.difficulty,
      goals: originalProgram.goals,
      createdBy: user._id,
    });

    // Duplicate all workouts
    const workouts = await ctx.db
      .query("workouts")
      .withIndex("by_program", (q) => q.eq("programId", args.id))
      .collect();

    for (const workout of workouts) {
      await ctx.db.insert("workouts", {
        programId: newProgramId,
        name: workout.name,
        day: workout.day,
        week: workout.week,
        exercises: workout.exercises,
      });
    }

    return newProgramId;
  },
});
