import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { AppProviders } from "./features/auth/AppProviders.tsx";
import { AppShell } from "./navigation/AppShell.tsx";
import { SignInScreen } from "./screens/auth/SignInScreen.tsx";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import { TrainScreen } from "./screens/TrainScreen.tsx";
import { NutritionScreen } from "./screens/NutritionScreen.tsx";
import { ProgressScreen } from "./screens/ProgressScreen.tsx";
import { AICoachScreen } from "./screens/AICoachScreen.tsx";
import { SettingsScreen } from "./screens/settings/SettingsScreen.tsx";
import { DeleteAccountScreen } from "./screens/settings/DeleteAccountScreen.tsx";
import { LoadingState } from "./ui/StateViews.tsx";

/**
 * The new Sombrey mobile app's entry point. Does NOT import anything
 * from src/App.tsx (the legacy SPA) — no shared route tree, no shared
 * layout, no shared auth provider.
 *
 * Approved IA (V1): Home / Train / Progress / AI / Settings — five
 * primary destinations, matching the Studio Instrument navigation
 * ticks (see ui/NavTicks.tsx). This supersedes the earlier five-tab
 * set (Home / Train / Nutrition / Progress / Profile): Nutrition is
 * now a detail screen reached from Home, not its own destination, and
 * Profile's content moved into Settings. AI, previously excluded as a
 * "sixth tab," is now one of the five per every approved Studio
 * Instrument screen design — see the implementation report for why
 * this earlier decision was revisited.
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
              <Route path="/home/nutrition" element={<NutritionScreen />} />
              <Route path="/train" element={<TrainScreen />} />
              <Route path="/progress" element={<ProgressScreen />} />
              <Route path="/ai" element={<AICoachScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/settings/delete-account" element={<DeleteAccountScreen />} />
            </Route>
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </Authenticated>
      </BrowserRouter>
    </AppProviders>
  );
}
