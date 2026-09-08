import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    // Legacy single-role field (kept for backward compat)
    role: v.optional(v.union(
      v.literal("client"),
      v.literal("coach"),
      v.literal("assistant_coach"),
      v.literal("store_manager"),
      v.literal("admin"),
      v.literal("owner")
    )),
    // Multi-role array (takes precedence over `role` when present)
    roles: v.optional(v.array(v.union(
      v.literal("client"),
      v.literal("coach"),
      v.literal("assistant_coach"),
      v.literal("store_manager"),
      v.literal("admin"),
      v.literal("owner")
    ))),
    subscriptionTier: v.union(
      v.literal("free"),
      v.literal("premium"),
      v.literal("coaching_client"),
      // Legacy tiers — kept for migration safety, treated as premium or coaching_client
      v.literal("self_guided"),
      v.literal("semi_guided"),
      v.literal("full_guided")
    ),
    // Custom per-client coaching price (cents), set by coach/admin/owner
    coachingPriceCents: v.optional(v.number()),
    coachId: v.optional(v.id("users")),
    onboardingCompleted: v.boolean(),
    avatarStorageId: v.optional(v.id("_storage")),
    customerId: v.optional(v.string()),
    disabled: v.optional(v.boolean()),
    // Extended profile fields
    dateOfBirth: v.optional(v.string()),         // ISO date string e.g. "1995-04-12"
    heightCm: v.optional(v.number()),            // height in centimetres
    weightKg: v.optional(v.number()),            // current weight in kg
    startingWeightKg: v.optional(v.number()),    // weight at onboarding / first log
    goalWeightKg: v.optional(v.number()),        // target weight in kg
    // Offline / manual payment status (separate from Hercules Commerce Stripe)
    paymentStatus: v.optional(v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("suspended"),
    )),
    // Admin-granted premium access (no payment required)
    // When true, user has premium features regardless of Commerce subscription status
    adminGrantedPremium: v.optional(v.boolean()),
    adminGrantedPremiumAt: v.optional(v.string()),   // ISO 8601 UTC
    adminGrantedPremiumBy: v.optional(v.id("users")), // who granted it
    // Marketing consent — opt-in only, recorded at the profile creation step
    marketingConsent: v.optional(v.boolean()),        // true = opted in
    marketingConsentAt: v.optional(v.string()),       // ISO 8601 UTC when consent was given
  }).index("by_token", ["tokenIdentifier"])
    .index("by_coach", ["coachId"])
    .index("by_payment_status", ["paymentStatus"]),

  offlinePayments: defineTable({
    userId: v.id("users"),
    amount: v.number(), // in cents
    currency: v.string(), // e.g. "USD"
    method: v.union(v.literal("bank_transfer"), v.literal("cash"), v.literal("other")),
    referenceNote: v.optional(v.string()), // e.g. bank transfer ref number
    tier: v.union(
      v.literal("free"),
      v.literal("premium"),
      v.literal("coaching_client"),
      v.literal("self_guided"),
      v.literal("semi_guided"),
      v.literal("full_guided")
    ),
    status: v.union(v.literal("pending"), v.literal("confirmed"), v.literal("rejected")),
    createdAt: v.string(),   // ISO 8601 UTC
    confirmedAt: v.optional(v.string()),
    confirmedBy: v.optional(v.id("users")), // owner who confirmed
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_status", ["status"]),

  auditLogs: defineTable({
    actorId: v.id("users"),
    actorEmail: v.optional(v.string()),
    targetId: v.optional(v.id("users")),
    targetEmail: v.optional(v.string()),
    action: v.string(), // e.g. "roles_updated", "user_disabled", "user_deleted"
    details: v.optional(v.string()),
    timestamp: v.string(), // ISO 8601 UTC
  }).index("by_timestamp", ["timestamp"])
    .index("by_target", ["targetId"]),

  coachInvites: defineTable({
    email: v.string(),
    token: v.string(),
    invitedBy: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
    createdAt: v.string(), // ISO 8601 UTC
    expiresAt: v.string(), // ISO 8601 UTC
    acceptedAt: v.optional(v.string()),
    // Extended fields for client invites
    inviteType: v.optional(v.union(v.literal("coach"), v.literal("client"))),
    clientName: v.optional(v.string()),
    subscriptionTier: v.optional(v.union(
      v.literal("free"),
      v.literal("premium"),
      v.literal("coaching_client"),
      v.literal("self_guided"),
      v.literal("semi_guided"),
      v.literal("full_guided")
    )),
    assignedCoachId: v.optional(v.id("users")),
    billingMethod: v.optional(v.union(v.literal("stripe"), v.literal("bank_transfer"))),
  }).index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_status", ["status"]),

  // Cache table — records which WorkoutX queries have already been synced into Convex.
  // Key is a normalized query string (e.g. "bodyPart:back", "name:bench press").
  // Once a query is cached, subsequent requests are served from Convex with zero WX API calls.
  wxQueryCache: defineTable({
    cacheKey: v.string(),   // normalized query identifier
    cachedAt: v.number(),   // Unix ms timestamp — used to expire stale cache entries
  }).index("by_key", ["cacheKey"]),

  exercises: defineTable({
    name: v.string(),
    description: v.string(),
    videoUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    muscleGroup: v.union(
      v.literal("chest"),
      v.literal("back"),
      v.literal("shoulders"),
      v.literal("arms"),
      v.literal("legs"),
      v.literal("core"),
      v.literal("cardio")
    ),
    equipment: v.array(v.string()),
    primaryMuscles: v.array(v.string()),
    secondaryMuscles: v.array(v.string()),
    instructions: v.array(v.string()),
    cues: v.array(v.string()),
    safetyNotes: v.optional(v.string()),
    programPhase: v.optional(v.union(
      v.literal("metabolic_rewire"),
      v.literal("anabolic_surge"),
      v.literal("body_recode")
    )),
    // WorkoutX integration fields — populated for WX-sourced exercises
    workoutxId: v.optional(v.string()),  // WorkoutX exercise ID (e.g. "0001")
    gifUrl: v.optional(v.string()),       // WorkoutX GIF URL for demonstration
    wxBodyPart: v.optional(v.string()),   // WorkoutX bodyPart field
    wxTarget: v.optional(v.string()),     // WorkoutX target muscle
  }).index("by_muscle_group", ["muscleGroup"])
    .index("by_phase", ["programPhase"])
    .index("by_workoutx_id", ["workoutxId"]),

  programs: defineTable({
    name: v.string(),
    description: v.string(),
    phase: v.union(
      v.literal("metabolic_rewire"),
      v.literal("anabolic_surge"),
      v.literal("body_recode")
    ),
    durationWeeks: v.number(),
    difficulty: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
    goals: v.array(v.string()),
    createdBy: v.id("users"),
  }).index("by_creator", ["createdBy"])
    .index("by_phase", ["phase"]),

  workouts: defineTable({
    programId: v.id("programs"),
    // When set, this workout belongs exclusively to a specific client (client-specific copy).
    // Template workouts (shared across all clients) have clientId undefined/null.
    clientId: v.optional(v.id("users")),
    name: v.string(),
    day: v.number(),
    week: v.number(),
    exercises: v.array(v.object({
      exerciseId: v.id("exercises"),
      // Legacy flat fields (kept for backward compat, new workouts use setConfigs)
      sets: v.number(),
      reps: v.union(v.number(), v.string()),
      restSeconds: v.number(),
      notes: v.optional(v.string()),
      // Legacy intensifiers (exercise-level)
      supersetWith: v.optional(v.id("exercises")),
      isDropSet: v.optional(v.boolean()),
      tempo: v.optional(v.string()),
      suggestedWeightKg: v.optional(v.number()),
      rpe: v.optional(v.number()),
      // NEW: per-set configuration array (takes precedence over legacy fields)
      setConfigs: v.optional(v.array(v.object({
        setNumber: v.number(),
        reps: v.optional(v.union(v.number(), v.string())),
        weightKg: v.optional(v.number()),
        restSeconds: v.optional(v.number()),
        // Per-set intensifier
        intensifierType: v.optional(v.union(
          v.literal("superset"),
          v.literal("dropset"),
          v.literal("tempo"),
          v.literal("rpe"),
          v.literal("suggested_weight"),
        )),
        intensifierValue: v.optional(v.string()), // stringified detail
        // Drop set sub-sets
        dropSubSets: v.optional(v.array(v.object({
          subSetNumber: v.number(),
          weightKg: v.optional(v.number()),
          reps: v.optional(v.number()),
          restSeconds: v.optional(v.number()),
        }))),
        // Superset link
        supersetExerciseId: v.optional(v.id("exercises")),
        notes: v.optional(v.string()),
      }))),
    })),
  }).index("by_program", ["programId"])
    .index("by_program_and_week", ["programId", "week"])
    .index("by_client_and_program", ["clientId", "programId"]),

  assignedPrograms: defineTable({
    userId: v.id("users"),
    programId: v.id("programs"),
    startDate: v.number(),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("paused")),
    currentWeek: v.number(),
    currentDay: v.number(),
  }).index("by_user", ["userId"])
    .index("by_user_and_status", ["userId", "status"]),

  workoutLogs: defineTable({
    userId: v.id("users"),
    workoutId: v.id("workouts"),
    completedAt: v.number(),
    exercises: v.array(v.object({
      exerciseId: v.id("exercises"),
      sets: v.array(v.object({
        weight: v.number(),
        reps: v.number(),
        completed: v.boolean(),
      })),
    })),
    duration: v.number(),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_workout", ["workoutId"])
    .index("by_user_and_date", ["userId", "completedAt"]),

  foods: defineTable({
    name: v.string(),
    protein: v.number(),
    carbs: v.number(),
    fats: v.number(),
    calories: v.number(),
    servingSize: v.string(),
    servingUnit: v.string(),
    category: v.optional(v.string()),
    isCustom: v.boolean(),
    isArchived: v.optional(v.boolean()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.optional(v.string()),  // ISO 8601
    lastModifiedBy: v.optional(v.id("users")),
    lastModifiedAt: v.optional(v.string()), // ISO 8601
    // Per-100g nutritional values for automatic macro recalculation when grams are edited
    caloriesPer100g: v.optional(v.number()),
    proteinPer100g: v.optional(v.number()),
    carbsPer100g: v.optional(v.number()),
    fatsPer100g: v.optional(v.number()),
  }).index("by_creator", ["createdBy"])
    .index("by_archived", ["isArchived"]),

  mealPlans: defineTable({
    userId: v.id("users"),
    name: v.string(),
    targetCalories: v.number(),
    targetProtein: v.number(),
    targetCarbs: v.number(),
    targetFats: v.number(),
    targetFiber: v.optional(v.number()),
    targetWaterMl: v.optional(v.number()),
    meals: v.array(v.object({
      id: v.string(), // client-generated uuid for ordering/keying
      name: v.string(),
      time: v.optional(v.string()),
      displayOrder: v.number(),
      foods: v.array(v.object({
        foodId: v.id("foods"),
        servings: v.number(),
        // Optional gram-based quantity (takes precedence over servings for macro calc when per100g data exists)
        quantityInGrams: v.optional(v.number()),
      })),
    })),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_user_and_active", ["userId", "isActive"]),

  nutritionLogs: defineTable({
    userId: v.id("users"),
    date: v.number(),
    foods: v.array(v.object({
      foodId: v.id("foods"),
      servings: v.number(),
      mealType: v.string(),
      // Stable per-entry ID for safe removal without relying on array index.
      // Added in batch-2 fix; older log entries may not have this field.
      entryId: v.optional(v.string()),
    })),
    totalCalories: v.number(),
    totalProtein: v.number(),
    totalCarbs: v.number(),
    totalFats: v.number(),
  }).index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "date"]),

  progressPhotos: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    date: v.number(),
    view: v.union(v.literal("front"), v.literal("back"), v.literal("side")),
    weight: v.optional(v.number()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "date"]),

  measurements: defineTable({
    userId: v.id("users"),
    date: v.number(),
    weight: v.optional(v.number()),
    bodyFat: v.optional(v.number()),
    chest: v.optional(v.number()),
    waist: v.optional(v.number()),
    hips: v.optional(v.number()),
    arms: v.optional(v.number()),
    thighs: v.optional(v.number()),
    calves: v.optional(v.number()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "date"]),

  checkIns: defineTable({
    userId: v.id("users"),
    coachId: v.id("users"),
    date: v.number(),
    type: v.union(v.literal("daily"), v.literal("weekly")),
    questions: v.array(v.object({
      question: v.string(),
      answer: v.string(),
    })),
    status: v.union(v.literal("pending"), v.literal("reviewed")),
    coachFeedback: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_coach", ["coachId"])
    .index("by_user_and_date", ["userId", "date"]),

  communityPosts: defineTable({
    userId: v.id("users"),
    content: v.string(),
    type: v.union(
      v.literal("general"),
      v.literal("achievement"),
      v.literal("workout"),
      v.literal("nutrition"),
      v.literal("progress")
    ),
    imageStorageId: v.optional(v.id("_storage")),
    likesCount: v.number(),
    commentsCount: v.number(),
    workoutData: v.optional(v.object({
      workoutName: v.string(),
      duration: v.number(),
      exerciseCount: v.number(),
    })),
  }).index("by_user", ["userId"]),

  postLikes: defineTable({
    postId: v.id("communityPosts"),
    userId: v.id("users"),
  }).index("by_post", ["postId"])
    .index("by_post_and_user", ["postId", "userId"]),

  postComments: defineTable({
    postId: v.id("communityPosts"),
    userId: v.id("users"),
    content: v.string(),
  }).index("by_post", ["postId"])
    .index("by_user", ["userId"]),

  storeProducts: defineTable({
    productId: v.string(), // Hercules Commerce product ID
    name: v.string(),
    description: v.string(),
    category: v.string(),
    imageUrl: v.string(),
    badge: v.optional(v.string()),
    featured: v.boolean(),
    active: v.boolean(),
    displayOrder: v.number(),
    variants: v.array(v.object({
      id: v.string(),
      name: v.string(),
      price: v.number(), // in cents
    })),
    stockQuantity: v.optional(v.number()), // total units available
    lowStockThreshold: v.optional(v.number()), // alert threshold, default 5
  }).index("by_active", ["active"])
    .index("by_featured", ["featured"])
    .index("by_display_order", ["displayOrder"]),

  inventoryLogs: defineTable({
    productId: v.id("storeProducts"),
    userId: v.id("users"),
    userName: v.string(),
    changeAmount: v.number(), // positive = increase, negative = decrease
    previousQuantity: v.number(),
    newQuantity: v.number(),
    reason: v.optional(v.string()),
  }).index("by_product", ["productId"])
    .index("by_user", ["userId"]),

  cartItems: defineTable({
    userId: v.id("users"),
    productId: v.id("storeProducts"),
    variantId: v.string(),
    variantName: v.string(),
    quantity: v.number(),
    // Snapshot of price at time of add (cents) – refreshed on checkout
    priceAtAdd: v.number(),
  }).index("by_user", ["userId"])
    .index("by_user_product_variant", ["userId", "productId", "variantId"]),

  storeOrders: defineTable({
    // Customer info
    customerId: v.optional(v.id("users")),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.optional(v.string()),
    // Shipping
    shippingFullName: v.string(),
    shippingAddress: v.string(),
    shippingCity: v.string(),
    shippingCountry: v.string(),
    shippingPostalCode: v.string(),
    // Items: snapshot at order time
    items: v.array(v.object({
      productId: v.optional(v.id("storeProducts")),
      productName: v.string(),
      variantName: v.optional(v.string()),
      quantity: v.number(),
      unitPriceCents: v.number(),
    })),
    totalCents: v.number(),
    currency: v.string(),
    // Fulfillment
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled"),
    ),
    trackingNumber: v.optional(v.string()),
    fulfillmentNotes: v.optional(v.string()),
    // Commerce reference
    commerceOrderId: v.optional(v.string()),
    orderDate: v.string(), // ISO 8601
  }).index("by_status", ["status"])
    .index("by_customer", ["customerId"])
    .index("by_order_date", ["orderDate"]),

  messages: defineTable({
    senderId: v.id("users"),
    recipientId: v.id("users"),
    content: v.string(),
    type: v.union(v.literal("text"), v.literal("image"), v.literal("video"), v.literal("voice")),
    storageId: v.optional(v.id("_storage")),
    read: v.boolean(),
  }).index("by_recipient", ["recipientId"])
    .index("by_sender", ["senderId"])
    .index("by_conversation", ["senderId", "recipientId"]),

  marketingIntegrations: defineTable({
    platform:   v.string(), // e.g. "meta_pixel", "google_analytics_4"
    pixelId:    v.optional(v.string()),
    trackingId: v.optional(v.string()),
    apiKey:     v.optional(v.string()),
    apiSecret:  v.optional(v.string()),
    enabled:    v.boolean(),
    notes:      v.optional(v.string()),
    createdAt:  v.string(), // ISO 8601
    updatedAt:  v.string(), // ISO 8601
  }).index("by_platform", ["platform"]),

  // AI-powered meal photo logs
  mealPhotoLogs: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    loggedDate: v.string(),          // ISO date "YYYY-MM-DD"
    loggedAt: v.number(),            // ms since epoch
    mealType: v.optional(v.string()), // breakfast, lunch, dinner, snack
    description: v.optional(v.string()),
    // AI-generated macros (immutable by clients)
    aiCalories: v.optional(v.number()),
    aiProtein: v.optional(v.number()),
    aiCarbs: v.optional(v.number()),
    aiFats: v.optional(v.number()),
    aiAnalysis: v.optional(v.string()),  // AI text description of the meal
    aiStatus: v.union(v.literal("pending"), v.literal("done"), v.literal("error")),
    // Optional client-entered manual macros
    manualCalories: v.optional(v.number()),
    manualProtein: v.optional(v.number()),
    manualCarbs: v.optional(v.number()),
    manualFats: v.optional(v.number()),
  }).index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "loggedDate"]),

  // Scheduled workouts — coach assigns workout to client on a specific date
  scheduledWorkouts: defineTable({
    coachId: v.id("users"),
    clientId: v.id("users"),
    workoutId: v.id("workouts"),
    scheduledDate: v.string(),        // ISO date "YYYY-MM-DD"
    scheduledAt: v.string(),          // ISO 8601 UTC timestamp
    notes: v.optional(v.string()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("skipped"),
      v.literal("rest")
    ),
    completedAt: v.optional(v.number()), // ms since epoch when client completed
  }).index("by_client", ["clientId"])
    .index("by_coach", ["coachId"])
    .index("by_client_and_date", ["clientId", "scheduledDate"])
    .index("by_coach_and_date", ["coachId", "scheduledDate"]),

  // Client workout performance logs (per scheduled workout)
  workoutPerformanceLogs: defineTable({
    userId: v.id("users"),
    workoutId: v.id("workouts"),
    scheduledWorkoutId: v.optional(v.id("scheduledWorkouts")),
    loggedDate: v.string(),           // ISO date "YYYY-MM-DD"
    loggedAt: v.number(),             // ms since epoch
    exercises: v.array(v.object({
      exerciseId: v.id("exercises"),
      exerciseName: v.string(),
      sets: v.array(v.object({
        setNumber: v.number(),
        weight: v.optional(v.number()),
        reps: v.optional(v.number()),
        completed: v.boolean(),
        rpe: v.optional(v.number()),
        notes: v.optional(v.string()),
      })),
    })),
    notes: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
  }).index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "loggedDate"])
    .index("by_workout", ["workoutId"]),

  // Client goals (one active goal per user)
  clientGoals: defineTable({
    userId: v.id("users"),
    primaryGoal: v.string(),          // free text
    targetWeightKg: v.optional(v.number()),
    targetBodyFatPct: v.optional(v.number()),
    targetDate: v.optional(v.string()), // ISO date string
    isActive: v.boolean(),
  }).index("by_user", ["userId"])
    .index("by_user_and_active", ["userId", "isActive"]),

  // Coach private notes per client
  coachClientNotes: defineTable({
    coachId: v.id("users"),
    clientId: v.id("users"),
    note: v.string(),
    category: v.optional(v.string()), // e.g. "motivation", "technique", "injury", "feedback"
    createdAt: v.string(), // ISO 8601
    updatedAt: v.string(), // ISO 8601
  }).index("by_coach_and_client", ["coachId", "clientId"]),

  // Coach nutrition assignments for a client
  mealLogs: defineTable({
    userId: v.id("users"),
    mealPlanId: v.id("mealPlans"),
    mealId: v.string(), // matches meal.id inside the plan
    date: v.number(), // UTC midnight ms
    completedAt: v.optional(v.string()), // ISO 8601 UTC
    imageStorageId: v.optional(v.id("_storage")),
    aiMacros: v.optional(v.object({
      calories: v.number(),
      protein: v.number(),
      carbs: v.number(),
      fats: v.number(),
      description: v.optional(v.string()),
    })),
    clientMacros: v.optional(v.object({
      calories: v.number(),
      protein: v.number(),
      carbs: v.number(),
      fats: v.number(),
    })),
    isCompleted: v.boolean(),
    notes: v.optional(v.string()),
  }).index("by_user_and_date", ["userId", "date"])
    .index("by_user_date_meal", ["userId", "date", "mealId"]),

  coachNutritionAssignments: defineTable({
    coachId: v.id("users"),
    clientId: v.id("users"),
    targetCalories: v.optional(v.number()),
    targetProtein: v.optional(v.number()),
    targetCarbs: v.optional(v.number()),
    targetFats: v.optional(v.number()),
    targetFiber: v.optional(v.number()),
    targetWaterMl: v.optional(v.number()),
    mealPlanId: v.optional(v.id("mealPlans")),
    customNotes: v.optional(v.string()),
    updatedAt: v.string(), // ISO 8601
  }).index("by_client", ["clientId"])
    .index("by_coach_and_client", ["coachId", "clientId"]),

  // Supplement protocols assigned by coaches
  supplementProtocols: defineTable({
    coachId: v.id("users"),
    clientId: v.id("users"),
    supplements: v.array(v.object({
      name: v.string(),
      dosage: v.string(),
      timing: v.string(),
      duration: v.optional(v.string()),
      notes: v.optional(v.string()),
    })),
    generalNotes: v.optional(v.string()),
    updatedAt: v.string(), // ISO 8601
  }).index("by_client", ["clientId"])
    .index("by_coach_and_client", ["coachId", "clientId"]),

  // ── Cardio sessions assigned by coaches ──────────────────────────────────
  scheduledCardio: defineTable({
    coachId: v.id("users"),
    clientId: v.id("users"),
    scheduledDate: v.string(),     // "YYYY-MM-DD"
    scheduledAt: v.string(),       // ISO 8601 UTC
    cardioType: v.string(),        // "Treadmill" | "Stair Climber" | "Outdoor Run" | etc.
    targetDurationMinutes: v.number(),
    targetDistanceKm: v.optional(v.number()),
    targetPace: v.optional(v.string()),   // e.g. "5:30 /km"
    targetSpeed: v.optional(v.number()),  // km/h
    targetIncline: v.optional(v.number()),
    targetResistance: v.optional(v.number()),
    intensity: v.optional(v.union(
      v.literal("low"),
      v.literal("moderate"),
      v.literal("high"),
      v.literal("max"),
    )),
    notes: v.optional(v.string()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("skipped"),
    ),
    completedAt: v.optional(v.number()),
  }).index("by_client", ["clientId"])
    .index("by_coach", ["coachId"])
    .index("by_client_and_date", ["clientId", "scheduledDate"])
    .index("by_coach_and_date", ["coachId", "scheduledDate"]),

  // ── Cardio performance logs (client logs actual performance) ──────────────
  cardioLogs: defineTable({
    userId: v.id("users"),
    scheduledCardioId: v.id("scheduledCardio"),
    loggedDate: v.string(),   // "YYYY-MM-DD"
    loggedAt: v.number(),     // ms since epoch
    actualDurationMinutes: v.number(),
    actualDistanceKm: v.optional(v.number()),
    actualPace: v.optional(v.string()),
    actualSpeed: v.optional(v.number()),
    caloriesBurned: v.optional(v.number()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "loggedDate"])
    .index("by_scheduled", ["scheduledCardioId"]),

  // ── Step goals assigned by coaches ───────────────────────────────────────
  scheduledStepGoals: defineTable({
    coachId: v.id("users"),
    clientId: v.id("users"),
    scheduledDate: v.string(),    // "YYYY-MM-DD" — the day this goal applies
    scheduledAt: v.string(),      // ISO 8601 UTC
    targetSteps: v.number(),
    targetCompletionDate: v.optional(v.string()), // "YYYY-MM-DD"
    notes: v.optional(v.string()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("skipped"),
    ),
    completedAt: v.optional(v.number()),
  }).index("by_client", ["clientId"])
    .index("by_coach", ["coachId"])
    .index("by_client_and_date", ["clientId", "scheduledDate"])
    .index("by_coach_and_date", ["coachId", "scheduledDate"]),

  // ── Step logs (client logs actual daily steps) ────────────────────────────
  stepLogs: defineTable({
    userId: v.id("users"),
    scheduledStepGoalId: v.id("scheduledStepGoals"),
    loggedDate: v.string(),   // "YYYY-MM-DD"
    loggedAt: v.number(),     // ms since epoch
    actualSteps: v.number(),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "loggedDate"])
    .index("by_scheduled", ["scheduledStepGoalId"]),

  // ── Custom per-client coaching subscriptions (private, coach/admin/owner only) ─
  coachingSubscriptions: defineTable({
    clientId: v.id("users"),
    coachId: v.id("users"),
    monthlyPriceCents: v.number(),   // e.g. 15000 = $150/month
    currency: v.string(),            // e.g. "USD"
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("cancelled")
    ),
    notes: v.optional(v.string()),   // private coach notes
    createdAt: v.string(),           // ISO 8601 UTC
    updatedAt: v.string(),           // ISO 8601 UTC
    createdBy: v.id("users"),        // coach/admin/owner who created it
  }).index("by_client", ["clientId"])
    .index("by_coach", ["coachId"])
    .index("by_status", ["status"]),

  // ── Premium onboarding questionnaire (one per user) ─────────────────────────
  premiumOnboarding: defineTable({
    userId: v.id("users"),
    primaryGoal: v.union(v.literal("build_muscle"), v.literal("lose_fat"), v.literal("recomp")),
    currentWeightKg: v.number(),
    heightCm: v.number(),
    age: v.number(),
    sex: v.union(v.literal("male"), v.literal("female"), v.literal("other")),
    trainingExperience: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
    trainingDaysPerWeek: v.number(),
    gymAccess: v.union(v.literal("full_gym"), v.literal("home_gym"), v.literal("bodyweight")),
    dietaryPreference: v.string(),
    allergiesRestrictions: v.optional(v.string()),
    targetWeightKg: v.optional(v.number()),
    preferredSplit: v.optional(v.string()),
    // New fields added for canonical onboarding
    mealsPerDay: v.optional(v.number()),                // 2–6
    coachingStyle: v.optional(v.union(                  // AI Coach personality
      v.literal("motivational"),
      v.literal("analytical"),
      v.literal("balanced")
    )),
    onboardingStep: v.optional(v.number()),             // last completed step (0-based) for resume
    completedAt: v.string(),   // ISO 8601 UTC
    updatedAt: v.string(),     // ISO 8601 UTC
  }).index("by_user", ["userId"]),

  // ── AI-generated personalised fitness plans ──────────────────────────────────
  aiGeneratedPlans: defineTable({
    userId: v.id("users"),
    primaryGoal: v.string(),
    workoutSplit: v.string(),    // e.g. "Push/Pull/Legs"
    workoutDays: v.array(v.object({
      dayName: v.string(),
      exercises: v.array(v.object({
        name: v.string(),
        sets: v.number(),
        reps: v.string(),        // e.g. "8-10" or "12"
        rest: v.optional(v.string()),
        notes: v.optional(v.string()),
      })),
    })),
    macroTargets: v.object({
      calories: v.number(),
      protein: v.number(),
      carbs: v.number(),
      fats: v.number(),
    }),
    meals: v.array(v.object({
      name: v.string(),
      time: v.optional(v.string()),
      calories: v.optional(v.number()),
      suggestions: v.array(v.string()),
    })),
    weeklySchedule: v.array(v.object({
      day: v.string(),
      type: v.string(),          // "Push", "Pull", "Legs", "Rest", etc.
      focus: v.optional(v.string()),
    })),
    coachNotes: v.optional(v.string()),
    generatedAt: v.string(),     // ISO 8601 UTC
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("error")),
    // 12-week program tracking
    startDate: v.optional(v.string()),   // ISO date "YYYY-MM-DD"
    endDate: v.optional(v.string()),     // ISO date "YYYY-MM-DD" (+84 days)
    currentWeek: v.optional(v.number()), // 1-12, derived from startDate
  }).index("by_user", ["userId"]),

  // ── Weekly check-ins for premium users ──────────────────────────────────────
  weeklyCheckIns: defineTable({
    userId: v.id("users"),
    planId: v.optional(v.id("aiGeneratedPlans")),
    weekNumber: v.number(),          // 1–12
    checkInDate: v.string(),         // ISO date "YYYY-MM-DD"
    submittedAt: v.string(),         // ISO 8601 UTC
    // Body metrics
    weightKg: v.number(),
    waistCm: v.optional(v.number()),
    chestCm: v.optional(v.number()),
    armsCm: v.optional(v.number()),
    legsCm: v.optional(v.number()),
    shouldersCm: v.optional(v.number()),
    // Performance
    energyLevel: v.number(),         // 1–5
    sleepQuality: v.number(),        // 1–5
    recoveryScore: v.number(),       // 1–5
    hungerLevel: v.number(),         // 1–5
    strengthChange: v.union(
      v.literal("decreased"),
      v.literal("same"),
      v.literal("increased"),
    ),
    // Progress photos (storage IDs from Convex File Storage)
    frontPhotoStorageId: v.optional(v.id("_storage")),
    sidePhotoStorageId: v.optional(v.id("_storage")),
    backPhotoStorageId: v.optional(v.id("_storage")),
    // Notes
    challenges: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Flags
    isInitialCheckIn: v.optional(v.boolean()),  // true for the baseline check-in before plan is revealed
    // AI body composition estimates (stored as estimates, not medical measurements)
    estimatedBodyFatPct: v.optional(v.number()), // e.g. 18.5 (%)
    estimatedBMI: v.optional(v.number()),         // e.g. 24.3
    // AI assessment (filled after submission)
    aiAssessment: v.optional(v.string()),      // AI's written assessment
    aiAssessmentStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("error"),
    )),
  }).index("by_user", ["userId"])
    .index("by_plan", ["planId"])
    .index("by_user_and_week", ["userId", "weekNumber"]),

  // ── AI plan modification proposals (created by coach chat, approved by user) ──
  planModifications: defineTable({
    userId: v.id("users"),
    planId: v.id("aiGeneratedPlans"),        // which plan this modifies
    // What the AI proposes to change
    changeType: v.union(
      v.literal("meal_substitution"),         // swap food in a meal
      v.literal("exercise_substitution"),     // swap exercise in a workout day
      v.literal("macro_update"),              // update calorie/macro targets
      v.literal("workout_split_change"),      // change training split/schedule
      v.literal("general_update"),            // multi-field or freeform
    ),
    description: v.string(),                  // human-readable summary shown in UI
    beforeSummary: v.string(),                // "before" text shown in diff
    afterSummary: v.string(),                 // "after" text shown in diff
    // The actual patch to apply on approval
    patch: v.string(),                        // JSON-serialised partial aiGeneratedPlans
    status: v.union(
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    createdAt: v.string(),                    // ISO 8601 UTC
    resolvedAt: v.optional(v.string()),       // ISO 8601 UTC
  }).index("by_user", ["userId"])
    .index("by_plan", ["planId"])
    .index("by_status", ["status"])
    .index("by_user_and_status", ["userId", "status"]),

  // Custom program phases created by coaches
  programPhases: defineTable({
    coachId: v.id("users"),
    clientId: v.optional(v.id("users")), // if assigned to specific client
    name: v.string(),
    description: v.optional(v.string()),
    startDate: v.optional(v.string()),   // ISO date string
    endDate: v.optional(v.string()),     // ISO date string
    programId: v.optional(v.id("programs")),
    mealPlanId: v.optional(v.id("mealPlans")),
    coachNotes: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("archived")),
    displayOrder: v.number(),
  }).index("by_coach", ["coachId"])
    .index("by_client", ["clientId"])
    .index("by_coach_and_order", ["coachId", "displayOrder"]),

  // ── AI Workout Logs (for AI-generated plan workouts, separate from program logs) ─
  aiWorkoutLogs: defineTable({
    userId: v.id("users"),
    planId: v.id("aiGeneratedPlans"),
    weekNumber: v.number(),             // 1–12
    workoutDayName: v.string(),         // e.g. "Push Day A"
    completedAt: v.string(),            // ISO 8601 UTC
    durationSeconds: v.optional(v.number()),
    exercises: v.array(v.object({
      exerciseName: v.string(),         // matches name in aiGeneratedPlans.workoutDays
      targetReps: v.array(v.number()),  // e.g. [15, 12, 10, 8] for that week
      sets: v.array(v.object({
        setNumber: v.number(),          // 1-based
        targetReps: v.number(),
        actualReps: v.number(),
        weightKg: v.number(),
        completed: v.boolean(),
        notes: v.optional(v.string()),
      })),
    })),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_plan", ["planId"])
    .index("by_user_and_week", ["userId", "weekNumber"]),

  // ── Per-exercise progression state for AI plan progressive overload ────────
  exerciseProgressions: defineTable({
    userId: v.id("users"),
    planId: v.id("aiGeneratedPlans"),
    exerciseName: v.string(),           // matches aiGeneratedPlans.workoutDays[].exercises[].name
    // Current progression state
    currentWeightKg: v.optional(v.number()),  // null until baseline set in week 1
    weightCycleWeek: v.number(),        // how many weeks into current weight cycle (resets to 1 after weight bump)
    lastLoggedWeek: v.optional(v.number()),
    // Plateau detection
    stallCount: v.number(),             // consecutive weeks failing to hit targets
    hasPlateaued: v.boolean(),
    plateauIntensifier: v.optional(v.string()), // e.g. "drop_set", "tempo", "shorter_rest"
    // History of weight bumps
    weightHistory: v.array(v.object({
      weightKg: v.number(),
      setAtWeek: v.number(),
      setAt: v.string(),               // ISO 8601
    })),
  }).index("by_user_and_plan", ["userId", "planId"])
    .index("by_user_plan_exercise", ["userId", "planId", "exerciseName"]),

  // ── Business email composer (owner/admin only) ───────────────────────────
  businessEmails: defineTable({
    // Who created/owns this email record
    authorId: v.id("users"),
    // Folder / lifecycle state
    folder: v.union(
      v.literal("inbox"),
      v.literal("sent"),
      v.literal("draft"),
      v.literal("archived"),
      v.literal("deleted"),
    ),
    // Inbound email fields (populated by Mailgun webhook)
    isInbound: v.optional(v.boolean()),
    fromAddress: v.optional(v.string()),  // sender email for inbound
    fromName: v.optional(v.string()),     // sender display name for inbound
    mailgunMessageId: v.optional(v.string()), // Mailgun message-id header
    // Business category
    category: v.union(
      v.literal("general"),
      v.literal("partnerships"),
      v.literal("sponsors"),
      v.literal("vendors"),
      v.literal("app_store"),
      v.literal("legal"),
    ),
    // Email fields
    toAddresses: v.array(v.string()),   // recipient email addresses
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),                   // plain-text / light html
    // Thread support: parentEmailId links replies to their parent
    parentEmailId: v.optional(v.id("businessEmails")),
    threadId: v.optional(v.id("businessEmails")), // always the root of the thread
    // Status
    isRead: v.boolean(),
    sentAt: v.optional(v.string()),     // ISO 8601 UTC — null for drafts
    createdAt: v.string(),              // ISO 8601 UTC
    updatedAt: v.string(),              // ISO 8601 UTC
  }).index("by_author", ["authorId"])
    .index("by_author_and_folder", ["authorId", "folder"])
    .index("by_thread", ["threadId"])
    .index("by_created", ["createdAt"])
    .index("by_mailgun_msgid", ["mailgunMessageId"]),

  // ── Email rate limiting: one entry per (user, emailType, date) ────────────
  emailRateLimits: defineTable({
    userId: v.id("users"),
    emailType: v.string(),   // e.g. "check_in_reminder", "support_confirmation"
    date: v.string(),        // ISO date "YYYY-MM-DD"
    sentAt: v.string(),      // ISO 8601 UTC
  }).index("by_user_and_date", ["userId", "date"]),

  // ── Support tickets ───────────────────────────────────────────────────────
  supportTickets: defineTable({
    userId: v.id("users"),
    userEmail: v.string(),
    userName: v.optional(v.string()),
    subscriptionTier: v.string(),
    subject: v.string(),
    message: v.string(),
    // Auto-collected device/app context
    deviceInfo: v.optional(v.string()),     // e.g. "Chrome 124 / macOS 14"
    appVersion: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("replied"),
      v.literal("closed"),
    ),
    createdAt: v.string(),                  // ISO 8601 UTC
    repliedAt: v.optional(v.string()),      // ISO 8601 UTC
    closedAt: v.optional(v.string()),       // ISO 8601 UTC
    // Admin reply history
    replies: v.array(v.object({
      adminId: v.id("users"),
      adminName: v.optional(v.string()),
      message: v.string(),
      sentAt: v.string(),                   // ISO 8601 UTC
    })),
  }).index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),

  // ── AI Coach chat history — persists conversation across sessions ─────────────
  // One thread per user (the AI Coach is a single persistent conversation).
  // Messages are immutable once stored; failed/incomplete AI responses are NOT stored.
  aiChatMessages: defineTable({
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    // If the assistant message came with a plan-change proposal, record its id
    // so the UI can re-render the approval card even after a full page reload.
    proposalId: v.optional(v.id("planModifications")),
  }).index("by_user", ["userId"]),

  // ── Workout version history — snapshots before each coach edit ───────────────
  workoutVersions: defineTable({
    workoutId: v.id("workouts"),           // the workout that was changed
    planVersion: v.number(),               // monotonically increasing version number
    effectiveDate: v.string(),             // ISO 8601 UTC — when this version became active
    changeSummary: v.string(),             // human-readable summary of what changed
    savedBy: v.id("users"),               // coach who made the change
    // Full snapshot of the exercises array before this edit
    exercisesSnapshot: v.string(),         // JSON-serialised exercises array
  }).index("by_workout", ["workoutId"])
    .index("by_workout_and_version", ["workoutId", "planVersion"]),
});
