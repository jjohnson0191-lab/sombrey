// Sombrey authentication — Clerk.
//
// domain must be the Clerk Frontend API URL (Clerk dashboard > Configure > API Keys).
// applicationID must match the name of a JWT template created in Clerk
// (Configure > JWT Templates > New template > Convex) — Convex's documented
// Clerk integration expects a template literally named "convex".
//
// No Hercules OIDC, no Hercules environment variables.
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL,
      applicationID: "convex",
    },
  ],
};
