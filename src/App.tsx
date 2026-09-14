import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import { useServiceWorker } from "@/hooks/use-service-worker.ts";
import AuthCallback from "./pages/auth/Callback.tsx";
import Index from "./pages/Index.tsx";
import Dashboard from "./pages/dashboard/page.tsx";
import ExercisesPage from "./pages/exercises/page.tsx";
import ExerciseDetailPage from "./pages/exercises/[id]/page.tsx";
import EditExercisePage from "./pages/exercises/[id]/edit/page.tsx";
import NewExercisePage from "./pages/exercises/new/page.tsx";
import ProgramsPage from "./pages/programs/page.tsx";
import ProgramDetailPage from "./pages/programs/[id]/page.tsx";
import NewProgramPage from "./pages/programs/new/page.tsx";
import NewWorkoutPage from "./pages/programs/[id]/workouts/new/page.tsx";
import WorkoutDetailPage from "./pages/workouts/[id]/page.tsx";
import EditWorkoutPage from "./pages/workouts/[id]/edit/page.tsx";
import NutritionPage from "./pages/nutrition/page.tsx";
import FoodsPage from "./pages/nutrition/foods/page.tsx";
import NewFoodPage from "./pages/nutrition/foods/new/page.tsx";
import MealPlansPage from "./pages/nutrition/meal-plans/page.tsx";
import MealLogPage from "./pages/nutrition/meal-log/page.tsx";
import CoachDashboard from "./pages/coach/page.tsx";
import ClientDashboardPage from "./pages/coach/clients/[id]/page.tsx";
import CalendarPage from "./pages/calendar/page.tsx";
import ProgressPage from "./pages/progress/page.tsx";
import MessagesPage from "./pages/messages/page.tsx";
import SubscriptionPage from "./pages/subscription/page.tsx";
import AiCoachPage from "./pages/ai-coach/page.tsx";
import CheckInPage from "./pages/check-in/page.tsx";
import AiWorkoutPage from "./pages/ai-workout/page.tsx";
import CommunityPage from "./pages/community/page.tsx";
import ProfilePage from "./pages/profile/page.tsx";
import StorePage from "./pages/store/page.tsx";
import StoreAdminPage from "./pages/store/admin.tsx";
import OwnerPage from "./pages/owner/page.tsx";
import BIPage from "./pages/bi/page.tsx";
import InviteAcceptPage from "./pages/invite/accept/page.tsx";
import CartPage from "./pages/store/cart/page.tsx";
import CompleteProfilePage from "./pages/complete-profile/page.tsx";
import AppLayout from "./components/app-layout.tsx";
import OnboardingGate from "./components/onboarding-gate.tsx";
import CoachingSubscriptionsPage from "./pages/coaching-subscriptions/page.tsx";
import PremiumOnboardingPage from "./pages/onboarding/page.tsx";
import AiPlanPage from "./pages/ai-plan/page.tsx";
import StoreOrdersPage from "./pages/store/orders/page.tsx";
import RoleGuard from "./components/role-guard.tsx";
import NotFound from "./pages/NotFound.tsx";
import PrivacyPolicyPage from "./pages/privacy-policy/page.tsx";
import TermsPage from "./pages/terms/page.tsx";
import ContactSupportPage from "./pages/contact-support/page.tsx";
import ProgressAnalyticsPage from "./pages/progress/analytics/page.tsx";
import ManagementPage from "./pages/management/page.tsx";

export default function App() {
  useServiceWorker();
  return (
    <DefaultProviders>
      <BrowserRouter>
        <Routes>
          {/* Outside layout - no bottom nav */}
          <Route path="/" element={<Index />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/invite/accept" element={<InviteAcceptPage />} />
          <Route path="/complete-profile" element={<CompleteProfilePage />} />
          <Route path="/onboarding" element={<PremiumOnboardingPage />} />

          {/* Inside layout - gets bottom nav, gated by onboarding */}
          <Route element={<OnboardingGate><AppLayout /></OnboardingGate>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/exercises" element={<ExercisesPage />} />
            <Route path="/exercises/new" element={<NewExercisePage />} />
            <Route path="/exercises/:id" element={<ExerciseDetailPage />} />
            <Route path="/exercises/:id/edit" element={<EditExercisePage />} />
            <Route path="/programs" element={<ProgramsPage />} />
            <Route path="/programs/new" element={<NewProgramPage />} />
            <Route path="/programs/:id" element={<ProgramDetailPage />} />
            <Route path="/programs/:id/workouts/new" element={<NewWorkoutPage />} />
            <Route path="/workouts/:id" element={<WorkoutDetailPage />} />
            <Route path="/workouts/:id/edit" element={<EditWorkoutPage />} />
            <Route path="/nutrition" element={<NutritionPage />} />
            <Route path="/nutrition/foods" element={<FoodsPage />} />
            <Route path="/nutrition/foods/new" element={<NewFoodPage />} />
            <Route path="/nutrition/meal-plans" element={<MealPlansPage />} />
            <Route path="/nutrition/meal-log" element={<MealLogPage />} />

            {/* Coach-only routes */}
            <Route
              path="/coach"
              element={
                <RoleGuard roles={["coach", "assistant_coach", "admin", "owner"]}>
                  <CoachDashboard />
                </RoleGuard>
              }
            />
            <Route
              path="/coach/clients/:id"
              element={
                <RoleGuard roles={["coach", "assistant_coach", "admin", "owner"]}>
                  <ClientDashboardPage />
                </RoleGuard>
              }
            />

            <Route
              path="/management"
              element={
                <RoleGuard roles={["coach", "assistant_coach", "admin", "owner"]}>
                  <ManagementPage />
                </RoleGuard>
              }
            />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/progress/analytics" element={<ProgressAnalyticsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
            <Route path="/ai-coach" element={<AiCoachPage />} />
            <Route path="/check-in" element={<CheckInPage />} />
            <Route path="/ai-plan" element={<AiPlanPage />} />
            <Route path="/ai-workout" element={<AiWorkoutPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/contact-support" element={<ContactSupportPage />} />
            <Route path="/store" element={<StorePage />} />
            <Route
              path="/store/admin"
              element={
                <RoleGuard roles={["store_manager", "admin", "owner"]}>
                  <StoreAdminPage />
                </RoleGuard>
              }
            />
            <Route path="/store/cart" element={<CartPage />} />
            <Route
              path="/store/orders"
              element={
                <RoleGuard roles={["admin", "owner"]}>
                  <StoreOrdersPage />
                </RoleGuard>
              }
            />
            <Route
              path="/coaching-subscriptions"
              element={
                <RoleGuard roles={["coach", "admin", "owner"]}>
                  <CoachingSubscriptionsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/owner"
              element={
                <RoleGuard roles={["admin", "owner"]}>
                  <OwnerPage />
                </RoleGuard>
              }
            />
            <Route
              path="/bi"
              element={
                <RoleGuard roles={["admin", "owner"]}>
                  <BIPage />
                </RoleGuard>
              }
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}
