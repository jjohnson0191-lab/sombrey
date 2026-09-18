import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { AppProviders } from "./features/auth/AppProviders.tsx";
import { AppShell } from "./navigation/AppShell.tsx";
import { SignInScreen } from "./screens/auth/SignInScreen.tsx";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import { TrainScreen } from "./screens/TrainScreen.tsx";
import { NutritionScreen } from "./screens/NutritionScreen.tsx";
import { ProgressScreen } from "./screens/ProgressScreen.tsx";
import { ProfileScreen } from "./screens/ProfileScreen.tsx";
import { SettingsScreen } from "./screens/settings/SettingsScreen.tsx";
import { DeleteAccountScreen } from "./screens/settings/DeleteAccountScreen.tsx";
import { LoadingState } from "./ui/StateViews.tsx";

/**
 * The new Sombrey mobile app's entry point. Does NOT import anything
 * from src/App.tsx (the legacy SPA) — no shared route tree, no shared
 * layout, no shared auth provider. Auth gating uses Convex's
 * Authenticated/Unauthenticated/AuthLoading (same primitive the legacy
 * app uses, because it's a Convex pattern, not a legacy-app one) driven
 * by Clerk via ConvexProviderWithClerk.
 */
export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AuthLoading>
          <LoadingState label="Signing in…" />
        </AuthLoading>

        <Unauthenticated>
          <SignInScreen />
        </Unauthenticated>

        <Authenticated>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/home" element={<HomeScreen />} />
              <Route path="/train" element={<TrainScreen />} />
              <Route path="/nutrition" element={<NutritionScreen />} />
              <Route path="/progress" element={<ProgressScreen />} />
              <Route path="/profile" element={<ProfileScreen />} />
              <Route path="/profile/settings" element={<SettingsScreen />} />
              <Route path="/profile/settings/delete-account" element={<DeleteAccountScreen />} />
            </Route>
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </Authenticated>
      </BrowserRouter>
    </AppProviders>
  );
}
