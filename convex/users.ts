import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { hasRole, getUserRoles, primaryRole } from "./lib/roles.js";

const ROLE_VALIDATOR = v.union(
  v.literal("client"),
  v.literal("coach"),
  v.literal("assistant_coach"),
  v.literal("store_manager"),
  v.literal("admin"),
  v.literal("owner"),
);

export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
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
    if (user !== null) {
      return user._id;
    }
    const newUserId = await ctx.db.insert("users", {
      name: identity.name,
      email: identity.email,
      tokenIdentifier: identity.tokenIdentifier,
      roles: ["client"],
      subscriptionTier: "free",
      onboardingCompleted: false,
    });
    await ctx.scheduler.runAfter(0, internal.commerce.subscriptions.ensureCustomer, {
      userId: newUserId,
      name: identity.name,
      email: identity.email,
    });
    // Send welcome email to new users who have an email address
    if (identity.email) {
      await ctx.scheduler.runAfter(0, internal.emails.transactional.sendWelcomeEmail, {
        toEmail: identity.email,
        name: identity.name ?? "Athlete",
      });
    }
    // Audit: log new signup
    await ctx.db.insert("auditLogs", {
      actorId: newUserId,
      actorEmail: identity.email,
      targetId: newUserId,
      targetEmail: identity.email,
      action: "user_signup",
      details: "New user signed up — assigned Client role",
      timestamp: new Date().toISOString(),
    });
    return newUserId;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Called getCurrentUser without authentication present",
      });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;
    const avatarUrl = user.avatarStorageId
      ? await ctx.storage.getUrl(user.avatarStorageId)
      : null;
    // Enrich with computed roles and coaching type
    const roles = getUserRoles(user);
    const pr = primaryRole(user);

    // Coaching type classification:
    //   owner       → owner
    //   coach / assistant_coach → coach
    //   admin / store_manager   → admin
    //   has coachId             → live_1to1_coaching_client
    //   premium/coaching tier   → ai_coaching_client
    //   free                    → free
    let coachingType: "owner" | "coach" | "admin" | "live_1to1_coaching_client" | "ai_coaching_client" | "free";
    if (roles.includes("owner")) {
      coachingType = "owner";
    } else if (roles.includes("coach") || roles.includes("assistant_coach")) {
      coachingType = "coach";
    } else if (roles.includes("admin") || roles.includes("store_manager")) {
      coachingType = "admin";
    } else if (user.coachId) {
      coachingType = "live_1to1_coaching_client";
    } else if (user.subscriptionTier !== "free") {
      coachingType = "ai_coaching_client";
    } else {
      coachingType = "free";
    }

    // Fetch coach name for live 1-on-1 clients
    let coachName: string | undefined;
    if (coachingType === "live_1to1_coaching_client" && user.coachId) {
      const coach = await ctx.db.get(user.coachId);
      coachName = coach?.name ?? undefined;
    }

    return {
      ...user,
      avatarUrl,
      effectiveRoles: roles,
      primaryRole: pr,
      coachingType,
      coachName,
    };
  },
});

export const getClientStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;

    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekStart = monday.getTime();

    const weeklyLogs = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).gte("completedAt", weekStart),
      )
      .collect();

    const allLogs = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const logDays = new Set(
      allLogs.map((l) => {
        const d = new Date(l.completedAt);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }),
    );
    let streak = 0;
    const check = new Date();
    while (true) {
      const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
      if (logDays.has(key)) {
        streak++;
        check.setDate(check.getDate() - 1);
      } else {
        break;
      }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const nutritionLog = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).eq("date", todayStart.getTime()),
      )
      .unique();

    const activeAssignment = await ctx.db
      .query("assignedPrograms")
      .withIndex("by_user_and_status", (q) =>
        q.eq("userId", user._id).eq("status", "active"),
      )
      .first();

    let activeProgram = null;
    if (activeAssignment) {
      const program = await ctx.db.get(activeAssignment.programId);
      activeProgram = {
        ...activeAssignment,
        programName: program?.name || "Unknown",
        programPhase: program?.phase,
        programDuration: program?.durationWeeks || 0,
      };
    }

    return {
      workoutsThisWeek: weeklyLogs.length,
      streak,
      caloriesToday: nutritionLog?.totalCalories || 0,
      proteinToday: nutritionLog?.totalProtein || 0,
      carbsToday: nutritionLog?.totalCarbs || 0,
      fatsToday: nutritionLog?.totalFats || 0,
      activeProgram,
      totalWorkouts: allLogs.length,
    };
  },
});

export const getCoachStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user || !hasRole(user, "coach", "admin", "assistant_coach", "owner")) return null;

    // Owner and Admin see stats across all clients; coaches see only their own
    let clients;
    if (hasRole(user, "owner") || hasRole(user, "admin")) {
      const allUsers = await ctx.db.query("users").collect();
      clients = allUsers.filter((u) => {
        const roles = getUserRoles(u);
        return roles.includes("client");
      });
    } else {
      clients = await ctx.db
        .query("users")
        .withIndex("by_coach", (q) => q.eq("coachId", user._id))
        .collect();
    }

    const clientIds = clients.map((c) => c._id);

    const allAssignments = await Promise.all(
      clientIds.map((cid) =>
        ctx.db
          .query("assignedPrograms")
          .withIndex("by_user_and_status", (q) =>
            q.eq("userId", cid).eq("status", "active"),
          )
          .collect(),
      ),
    );
    const activeAssignments = allAssignments.flat();

    const programs = await ctx.db
      .query("programs")
      .withIndex("by_creator", (q) => q.eq("createdBy", user._id))
      .collect();

    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekStart = monday.getTime();

    const weeklyLogCounts = await Promise.all(
      clientIds.map((cid) =>
        ctx.db
          .query("workoutLogs")
          .withIndex("by_user_and_date", (q) =>
            q.eq("userId", cid).gte("completedAt", weekStart),
          )
          .collect(),
      ),
    );
    const totalWorkoutsThisWeek = weeklyLogCounts.flat().length;

    const clientSummaries = await Promise.all(
      clients.map(async (client) => {
        const activeAssignment = await ctx.db
          .query("assignedPrograms")
          .withIndex("by_user_and_status", (q) =>
            q.eq("userId", client._id).eq("status", "active"),
          )
          .first();

        let programName: string | null = null;
        if (activeAssignment) {
          const prog = await ctx.db.get(activeAssignment.programId);
          programName = prog?.name ?? null;
        }

        const recentLog = await ctx.db
          .query("workoutLogs")
          .withIndex("by_user", (q) => q.eq("userId", client._id))
          .order("desc")
          .first();

        const weekLogs = await ctx.db
          .query("workoutLogs")
          .withIndex("by_user_and_date", (q) =>
            q.eq("userId", client._id).gte("completedAt", weekStart),
          )
          .collect();

        // Enriched profile data
        const avatarUrl = client.avatarStorageId
          ? await ctx.storage.getUrl(client.avatarStorageId)
          : null;

        const activeGoal = await ctx.db
          .query("clientGoals")
          .withIndex("by_user_and_active", (q) => q.eq("userId", client._id).eq("isActive", true))
          .first();

        const activePhase = await ctx.db
          .query("programPhases")
          .withIndex("by_client", (q) => q.eq("clientId", client._id))
          .collect()
          .then((phases) => phases.find((p) => p.status === "active") ?? null);

        // Progress % toward goal weight
        let progressPct: number | null = null;
        if (client.startingWeightKg && client.weightKg && client.goalWeightKg && client.startingWeightKg !== client.goalWeightKg) {
          const total = Math.abs(client.goalWeightKg - client.startingWeightKg);
          const done = Math.abs(client.weightKg - client.startingWeightKg);
          progressPct = Math.min(Math.round((done / total) * 100), 100);
        }

        // Last check-in
        const lastCheckIn = await ctx.db
          .query("checkIns")
          .withIndex("by_user_and_date", (q) => q.eq("userId", client._id))
          .order("desc")
          .first();

        return {
          _id: client._id,
          name: client.name ?? "Unknown",
          email: client.email,
          subscriptionTier: client.subscriptionTier,
          activeProgram: programName,
          workoutsThisWeek: weekLogs.length,
          lastWorkout: recentLog?.completedAt ?? null,
          // Enriched
          avatarUrl,
          dateOfBirth: client.dateOfBirth ?? null,
          heightCm: client.heightCm ?? null,
          weightKg: client.weightKg ?? null,
          goalWeightKg: client.goalWeightKg ?? null,
          primaryGoal: activeGoal?.primaryGoal ?? null,
          currentPhase: activePhase?.name ?? null,
          progressPct,
          lastCheckIn: lastCheckIn?.date ?? null,
        };
      }),
    );

    return {
      totalClients: clients.length,
      activeAssignments: activeAssignments.length,
      totalPrograms: programs.length,
      totalWorkoutsThisWeek,
      clients: clientSummaries,
      recentPrograms: programs.slice(-3).reverse(),
    };
  },
});

export const listClients = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];

    // Owner and Admin see all clients
    if (hasRole(user, "owner") || hasRole(user, "admin")) {
      const allUsers = await ctx.db.query("users").collect();
      return allUsers.filter((u) => {
        const roles = getUserRoles(u);
        return roles.includes("client");
      });
    }

    // Coaches and assistant coaches only see their assigned clients
    if (hasRole(user, "coach") || hasRole(user, "assistant_coach")) {
      return ctx.db
        .query("users")
        .withIndex("by_coach", (q) => q.eq("coachId", user._id))
        .collect();
    }

    return [];
  },
});

export const assignClientToCoach = mutation({
  args: { clientId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const coach = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    // #9 — assistant coaches may NOT self-assign clients; only coaches, admins, and
    // the owner may claim a client.  Owners/admins can always assign any client.
    if (!coach || !hasRole(coach, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches can assign clients" });
    }

    await ctx.db.patch(args.clientId, { coachId: coach._id });
  },
});

export const listAllUsers = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!requestingUser) return [];

    const isAdminOrOwner = hasRole(requestingUser, "admin") || hasRole(requestingUser, "owner");
    const isCoach = hasRole(requestingUser, "coach") || hasRole(requestingUser, "assistant_coach");

    if (!isAdminOrOwner && !isCoach) return [];

    let users;
    if (isAdminOrOwner) {
      users = await ctx.db.query("users").collect();
    } else {
      // Coach: only their assigned clients
      users = await ctx.db
        .query("users")
        .withIndex("by_coach", (q) => q.eq("coachId", requestingUser._id))
        .collect();
    }

    return Promise.all(
      users.map(async (u) => ({
        ...u,
        avatarUrl: u.avatarStorageId ? await ctx.storage.getUrl(u.avatarStorageId) : null,
        effectiveRoles: getUserRoles(u),
        primaryRole: primaryRole(u),
      }))
    );
  },
});

export const reassignClientCoach = mutation({
  args: {
    clientId: v.id("users"),
    newCoachId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!requestingUser || (!hasRole(requestingUser, "owner") && !hasRole(requestingUser, "admin"))) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only Owner or Admin can reassign coaches" });
    }

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "NOT_FOUND", message: "Client not found" });

    const newCoach = await ctx.db.get(args.newCoachId);
    if (!newCoach || !hasRole(newCoach, "coach")) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Selected user is not a Coach" });
    }

    const previousCoachId = client.coachId;
    await ctx.db.patch(args.clientId, { coachId: args.newCoachId });

    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.clientId,
      targetEmail: client.email,
      action: "coach_reassigned",
      details: `Coach changed from ${previousCoachId ?? "none"} to ${args.newCoachId} (${newCoach.name ?? newCoach.email})`,
      timestamp: new Date().toISOString(),
    });
  },
});

export const updateUserRoles = mutation({
  args: {
    userId: v.id("users"),
    roles: v.array(ROLE_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can change roles" });
    }

    const target = await ctx.db.get(args.userId);

    // Prevent removing all roles
    const roles = args.roles.length > 0 ? args.roles : ["client" as const];
    await ctx.db.patch(args.userId, { roles });

    // Audit log
    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.userId,
      targetEmail: target?.email,
      action: "roles_updated",
      details: `Roles set to: ${roles.join(", ")}`,
      timestamp: new Date().toISOString(),
    });
  },
});

export const setUserDisabled = mutation({
  args: {
    userId: v.id("users"),
    disabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can disable users" });
    }

    const target = await ctx.db.get(args.userId);
    await ctx.db.patch(args.userId, { disabled: args.disabled });

    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.userId,
      targetEmail: target?.email,
      action: args.disabled ? "user_disabled" : "user_activated",
      timestamp: new Date().toISOString(),
    });
  },
});

export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can delete users" });
    }
    if (args.userId === requestingUser._id) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Cannot delete your own account" });
    }

    const target = await ctx.db.get(args.userId);
    await ctx.db.delete(args.userId);

    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.userId,
      targetEmail: target?.email,
      action: "user_deleted",
      timestamp: new Date().toISOString(),
    });
  },
});

export const listAuditLogs = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner")) return [];

    return ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(100);
  },
});

// Keep legacy single-role mutation for backward compat
export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: ROLE_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can change roles" });
    }

    // Store as multi-role array
    await ctx.db.patch(args.userId, { roles: [args.role] });
  },
});

export const promoteToCoach = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can promote users to Coach" });
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const currentRoles = target.roles ?? [target.role ?? "client"];
    if (!currentRoles.includes("coach")) {
      await ctx.db.patch(args.userId, { roles: [...currentRoles, "coach"] });
    }

    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.userId,
      targetEmail: target.email,
      action: "roles_updated",
      details: "Promoted to Coach",
      timestamp: new Date().toISOString(),
    });
  },
});

export const grantPremiumAccess = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner", "admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only owner or admin can grant premium access" });
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const now = new Date().toISOString();
    await ctx.db.patch(args.userId, {
      subscriptionTier: "premium",
      adminGrantedPremium: true,
      adminGrantedPremiumAt: now,
      adminGrantedPremiumBy: requestingUser._id,
    });

    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.userId,
      targetEmail: target.email,
      action: "admin_granted_premium",
      details: `Premium access granted without payment by ${requestingUser.name ?? requestingUser.email}`,
      timestamp: now,
    });
  },
});

export const revokePremiumAccess = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner", "admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only owner or admin can revoke premium access" });
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const now = new Date().toISOString();
    await ctx.db.patch(args.userId, {
      subscriptionTier: "free",
      adminGrantedPremium: undefined,
      adminGrantedPremiumAt: undefined,
      adminGrantedPremiumBy: undefined,
    });

    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.userId,
      targetEmail: target.email,
      action: "admin_revoked_premium",
      details: `Admin-granted premium access revoked by ${requestingUser.name ?? requestingUser.email}`,
      timestamp: now,
    });
  },
});


export const setUserSubscriptionTier = mutation({
  args: {
    userId: v.id("users"),
    tier: v.union(
      v.literal("free"),
      v.literal("premium"),
      v.literal("coaching_client"),
      v.literal("self_guided"),
      v.literal("semi_guided"),
      v.literal("full_guided"),
    ),
    coachingPriceCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const requestingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!requestingUser || !hasRole(requestingUser, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can change subscription tiers" });
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const prevTier = target.subscriptionTier;
    await ctx.db.patch(args.userId, {
      subscriptionTier: args.tier,
      ...(args.coachingPriceCents !== undefined ? { coachingPriceCents: args.coachingPriceCents } : {}),
    });

    await ctx.db.insert("auditLogs", {
      actorId: requestingUser._id,
      actorEmail: requestingUser.email,
      targetId: args.userId,
      targetEmail: target.email,
      action: "subscription_tier_changed",
      details: `Tier changed from ${prevTier} → ${args.tier}`,
      timestamp: new Date().toISOString(),
    });
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    onboardingCompleted: v.optional(v.boolean()),
    // Marketing consent — only written when explicitly provided
    marketingConsent: v.optional(v.boolean()),
    marketingConsentAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    await ctx.db.patch(user._id, args);
  },
});

export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveAvatar = mutation({
  args: {
    storageId: v.id("_storage"),
    markOnboardingComplete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    // Delete old avatar from storage to save space
    if (user.avatarStorageId) {
      await ctx.storage.delete(user.avatarStorageId);
    }

    await ctx.db.patch(user._id, {
      avatarStorageId: args.storageId,
      ...(args.markOnboardingComplete ? { onboardingCompleted: true } : {}),
    });
  },
});

export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    if (user.avatarStorageId) {
      await ctx.storage.delete(user.avatarStorageId);
    }
    await ctx.db.patch(user._id, { avatarStorageId: undefined });
  },
});

export const updateExtendedProfile = mutation({
  args: {
    dateOfBirth: v.optional(v.string()),
    heightCm: v.optional(v.number()),
    weightKg: v.optional(v.number()),
    goalWeightKg: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const updates: {
      dateOfBirth?: string;
      heightCm?: number;
      weightKg?: number;
      goalWeightKg?: number;
      startingWeightKg?: number;
    } = {};
    if (args.dateOfBirth !== undefined) updates.dateOfBirth = args.dateOfBirth;
    if (args.heightCm !== undefined) updates.heightCm = args.heightCm;
    if (args.goalWeightKg !== undefined) updates.goalWeightKg = args.goalWeightKg;
    if (args.weightKg !== undefined) {
      updates.weightKg = args.weightKg;
      // Set startingWeightKg on first weight entry
      if (!user.startingWeightKg) updates.startingWeightKg = args.weightKg;
    }

    await ctx.db.patch(user._id, updates);
  },
});

/** Coach/Admin updating a client's extended profile */
export const updateClientExtendedProfile = mutation({
  args: {
    clientId: v.id("users"),
    dateOfBirth: v.optional(v.string()),
    heightCm: v.optional(v.number()),
    weightKg: v.optional(v.number()),
    goalWeightKg: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor) throw new ConvexError({ code: "NOT_FOUND", message: "Actor not found" });

    const roles = actor.roles ?? (actor.role ? [actor.role] : ["client"]);
    const isCoachOrAbove = roles.some((r) => ["coach", "admin", "owner", "assistant_coach"].includes(r));
    if (!isCoachOrAbove) throw new ConvexError({ code: "FORBIDDEN", message: "Forbidden" });

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "NOT_FOUND", message: "Client not found" });

    // #9 — assistant coaches may only edit clients assigned to them.
    // Coaches, admins, and owners are not restricted to their own clients here.
    if (roles.some(r => r === "assistant_coach") && !roles.some(r => ["coach", "admin", "owner"].includes(r))) {
      if (client.coachId !== actor._id) {
        throw new ConvexError({ code: "FORBIDDEN", message: "You can only edit your own assigned clients" });
      }
    }

    const updates: {
      dateOfBirth?: string;
      heightCm?: number;
      weightKg?: number;
      goalWeightKg?: number;
      startingWeightKg?: number;
    } = {};
    if (args.dateOfBirth !== undefined) updates.dateOfBirth = args.dateOfBirth;
    if (args.heightCm !== undefined) updates.heightCm = args.heightCm;
    if (args.goalWeightKg !== undefined) updates.goalWeightKg = args.goalWeightKg;
    if (args.weightKg !== undefined) {
      updates.weightKg = args.weightKg;
      if (!client.startingWeightKg) updates.startingWeightKg = args.weightKg;
    }

    await ctx.db.patch(args.clientId, updates);
  },
});

/** Look up a single user by ID — used by audit trail display. Coach/admin only. */
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const caller = await ctx.db.query("users").withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!caller) return null;
    if (!hasRole(caller, "coach", "admin", "owner") && caller._id !== args.userId) return null;
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return { _id: user._id, name: user.name, email: user.email };
  },
});

/**
 * Self-service account deletion — any authenticated user can delete their own account.
 * Removes the user record and, where possible, associated personal data.
 */
export const deleteSelfAccount = mutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    // Owners cannot self-delete (safety guard)
    if (hasRole(user, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner account cannot be deleted this way. Contact support." });
    }

    // Delete avatar from storage
    if (user.avatarStorageId) {
      await ctx.storage.delete(user.avatarStorageId);
    }

    // Delete the user record — cascading deletes for personal data happen via scheduled cleanup
    await ctx.db.delete(user._id);
  },
});
