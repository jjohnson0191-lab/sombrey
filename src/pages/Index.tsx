import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Dumbbell, TrendingUp, Users, Zap, Trophy, Target, CheckCircle2, XCircle, ChevronDown, ChevronUp, Sparkles, Camera, CalendarDays, BarChart3 } from "lucide-react";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";

function ActiveMemberRedirect() {
  const navigate = useNavigate();
  const currentUser = useQuery(api.users.getCurrentUser, {});

  useEffect(() => {
    if (!currentUser) return;
    const isActiveMember =
      currentUser.onboardingCompleted &&
      (
        (currentUser.subscriptionTier && currentUser.subscriptionTier !== "free") ||
        (currentUser.role && currentUser.role !== "client")
      );
    if (isActiveMember) {
      navigate("/dashboard", { replace: true });
    }
  }, [currentUser, navigate]);

  return null;
}

const FREE_FEATURES = [
  "Access to GOAT WALK community",
  "Access to store",
  "Access to blogs",
  "Access to vlogs",
];

const PREMIUM_FEATURES = [
  "AI Coach",
  "AI workout creation",
  "AI macro suggestions",
  "Camera AI Macro Calculator",
  "Meal logging",
  "Workout tracking",
  "Exercise performance tracking",
  "Progress photos",
  "Calendar",
  "Training analytics",
];

const FAQS = [
  {
    q: "What is included with GOAT WALK Premium?",
    a: "GOAT WALK Premium gives users access to AI-powered workout creation, nutrition guidance, macro suggestions, meal tracking, workout tracking, and progress tools — everything you need to build your physique.",
  },
  {
    q: "Do I need to subscribe to use GOAT WALK?",
    a: "No. You can create a free account and access the community, store, blogs, and vlogs at no cost. Upgrading to Premium unlocks all AI-powered fitness tools.",
  },
  {
    q: "How does the AI plan work?",
    a: "After subscribing, you complete a short onboarding questionnaire. Our AI uses your goals, stats, and preferences to generate a personalized workout program and macro targets — updated whenever your goal changes.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. You can cancel your GOAT WALK Premium subscription at any time with no lock-in period.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="w-full text-left border border-border rounded-xl px-5 py-4 bg-card/50 backdrop-blur hover:border-primary/40 transition-all duration-200 cursor-pointer"
      onClick={() => setOpen((v) => !v)}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="font-semibold text-sm md:text-base">{q}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </div>
      {open && <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{a}</p>}
    </button>
  );
}

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Authenticated>
        <ActiveMemberRedirect />
      </Authenticated>

      {/* Navigation */}
      <nav className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <span className="text-2xl font-bold tracking-tight text-foreground">GOAT WALK</span>
          <div className="flex items-center gap-3">
            <Unauthenticated>
              <SignInButton variant="secondary" size="sm" className="cursor-pointer hidden sm:inline-flex" signInText="Sign In" />
              <SignInButton size="sm" className="cursor-pointer" signInText="Sign Up" />
            </Unauthenticated>
            <Authenticated>
              <Button asChild>
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            </Authenticated>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-5xl mx-auto space-y-8"
        >
          <div className="inline-block px-4 py-2 bg-primary/10 border border-primary/30 rounded-full text-sm font-semibold text-primary glow-blue mb-4">
            AI-Powered Fitness Platform
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-balance">
            Build an Elite Physique
            <br />
            <span className="text-primary">Powered by AI</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto text-balance">
            Personalized training, nutrition guidance, progress tracking, and expert support — all in one platform. Start free, upgrade when you're ready.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Unauthenticated>
              <SignInButton size="lg" className="text-lg px-8 border-glow-blue cursor-pointer" signInText="Sign Up" />
              <SignInButton size="lg" variant="secondary" className="text-lg px-8 cursor-pointer" signInText="Sign In" />
            </Unauthenticated>
            <Authenticated>
              <Button size="lg" className="text-lg px-8 border-glow-blue" asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </Authenticated>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-20 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Everything You Need to Dominate</h2>
          <p className="text-muted-foreground text-lg">A complete fitness ecosystem built for results</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { icon: Sparkles, title: "AI Personalization", description: "Your workouts and nutrition are generated by AI based on your goals, stats, and preferences — and updated as you progress." },
            { icon: Target, title: "AI Nutrition Guidance", description: "Smart macro targets, meal suggestions, and an AI meal photo calculator so you always know what you're eating." },
            { icon: TrendingUp, title: "Progress Tracking", description: "Workout logs, performance charts, progress photos, and training analytics give you a complete picture of your gains." },
            { icon: Dumbbell, title: "Workout Programs", description: "AI-generated programs tailored to your split, equipment, and experience level — updated when your goal changes." },
            { icon: BarChart3, title: "Training Analytics", description: "Track volume, strength trends, and consistency over time so you always know what's working." },
            { icon: Users, title: "Community", description: "Connect with driven athletes, share progress, and stay accountable inside the GOAT WALK community." },
          ].map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              viewport={{ once: true }}
            >
              <Card className="h-full bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-all duration-300">
                <CardHeader>
                  <feature.icon className="w-12 h-12 text-primary mb-4" />
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">{feature.description}</CardDescription>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="container mx-auto px-4 py-20 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
          <p className="text-muted-foreground text-lg">Start free. Unlock everything for less than the cost of a single PT session.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {/* Free */}
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <Card className="h-full flex flex-col bg-card/50 backdrop-blur border-border">
              <CardHeader className="flex-grow">
                <CardTitle className="text-2xl">Free Account</CardTitle>
                <div className="pt-4">
                  <span className="text-4xl font-bold">$0</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <CardDescription className="pt-2">Start your journey — no credit card needed</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  {FREE_FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{f}</span>
                    </li>
                  ))}
                </ul>
                <Unauthenticated>
                  <SignInButton variant="secondary" className="w-full cursor-pointer" signInText="Create Free Account" />
                </Unauthenticated>
                <Authenticated>
                  <Button variant="secondary" className="w-full" asChild>
                    <Link to="/dashboard">Go to Dashboard</Link>
                  </Button>
                </Authenticated>
              </CardContent>
            </Card>
          </motion.div>

          {/* Premium */}
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} viewport={{ once: true }}>
            <Card className="h-full flex flex-col bg-primary/10 border-primary border-2 border-glow-blue">
              <CardHeader className="flex-grow">
                <div className="inline-block px-3 py-1 bg-primary text-primary-foreground rounded-full text-xs font-bold mb-2 w-fit">
                  MOST POPULAR
                </div>
                <CardTitle className="text-2xl">GOAT WALK Premium</CardTitle>
                <div className="pt-4">
                  <span className="text-4xl font-bold">$9.99</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <CardDescription className="pt-2">Full AI-powered fitness ecosystem</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  {PREMIUM_FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{f}</span>
                    </li>
                  ))}
                </ul>
                <Unauthenticated>
                  <SignInButton className="w-full cursor-pointer" signInText="Start GOAT WALK Premium" />
                </Unauthenticated>
                <Authenticated>
                  <Button className="w-full" asChild>
                    <Link to="/subscription">Start GOAT WALK Premium</Link>
                  </Button>
                </Authenticated>
              </CardContent>
            </Card>
          </motion.div>
        </div>

      </section>

      {/* Comparison */}
      <section className="container mx-auto px-4 py-20 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">A Smarter Way to Train</h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            GOAT WALK Premium gives you intelligent, personalized guidance — without guesswork.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
            <Card className="h-full bg-card/50 border-border">
              <CardHeader>
                <CardTitle className="text-lg text-muted-foreground">Doing It Alone</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {[
                    "Generic programs that don't fit your goals",
                    "No feedback on progress or plateaus",
                    "Guessing on nutrition and macros",
                    "No structure, low consistency",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
            <Card className="h-full bg-primary/10 border-primary/40">
              <CardHeader>
                <CardTitle className="text-lg text-primary">GOAT WALK Premium</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {[
                    "AI-powered guidance at $9.99/mo",
                    "Personalized workouts generated instantly",
                    "Nutrition support & macro targets",
                    "Progress tracking & analytics",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section className="container mx-auto px-4 py-20 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Frequently Asked Questions</h2>
          <p className="text-muted-foreground text-lg">Everything you need to know</p>
        </div>
        <div className="max-w-2xl mx-auto space-y-3">
          {FAQS.map((faq) => (
            <motion.div
              key={faq.q}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <FaqItem q={faq.q} a={faq.a} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-20 border-t border-border">
        <Card className="bg-gradient-to-r from-primary/20 to-accent/20 border-primary/30 border-glow-blue">
          <CardHeader className="text-center space-y-4 py-12">
            <CardTitle className="text-4xl font-bold">
              Ready to Build Your Dream Physique?
            </CardTitle>
            <CardDescription className="text-lg max-w-2xl mx-auto">
              Join athletes transforming their bodies with AI-powered training and personalized nutrition guidance.
            </CardDescription>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Unauthenticated>
                <SignInButton size="lg" className="text-lg px-12 border-glow-blue cursor-pointer" signInText="Sign Up" />
                <SignInButton size="lg" variant="secondary" className="text-lg px-8 cursor-pointer" signInText="Sign In" />
              </Unauthenticated>
              <Authenticated>
                <Button size="lg" className="text-lg px-12 border-glow-blue" asChild>
                  <Link to="/dashboard">Go to Dashboard</Link>
                </Button>
              </Authenticated>
            </div>
          </CardHeader>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <span className="font-bold text-foreground">GOAT WALK</span>
            <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} GOAT WALK. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
