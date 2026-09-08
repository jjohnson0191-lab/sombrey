import { Shield, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Link } from "react-router-dom";

const SECTIONS = [
  {
    title: "What Data We Collect",
    content: `When you use GOAT WALK, we collect information you provide directly:

• Account information: name, email address, profile photo
• Fitness data: weight, body measurements, progress photos, workout logs
• Nutrition data: meals logged, macro targets, food preferences
• Health context: fitness goals, training experience, dietary preferences
• Usage data: app activity, session duration, feature interactions

We do not collect payment card details — all payments are securely processed by our payment provider.`,
  },
  {
    title: "AI Processing",
    content: `GOAT WALK uses AI to power your personalized coaching experience:

• Your fitness data, goals, and check-in history are sent to AI models (powered by OpenAI GPT) to generate personalized workout plans, nutrition plans, and coaching responses.
• Progress photos you submit are analyzed by AI vision models solely to estimate body composition trends for coaching purposes.
• AI-generated assessments are stored in your account so your coach can reference them.
• Your conversations with the AI Coach are processed in real time and are not stored permanently between sessions.

AI estimates (such as body fat %) are for trend tracking only and are not medical measurements.`,
  },
  {
    title: "Photo Storage",
    content: `Progress photos you upload are:

• Stored securely in Convex cloud storage associated with your account
• Only accessible to you and, if applicable, your assigned coach
• Used solely for progress tracking and AI body composition analysis
• Never shared with third parties or used for advertising
• Permanently deleted when you delete your account

You may delete individual progress photos at any time from the Check-In section.`,
  },
  {
    title: "Subscription Data",
    content: `If you subscribe to GOAT WALK Premium:

• Your subscription status is stored in your account record
• Payment processing is handled by our third-party payment provider
• We store only the subscription status and renewal dates — not payment card details
• Subscription data is used to determine which features you can access
• You can manage or cancel your subscription at any time from Profile → My Subscription`,
  },
  {
    title: "Account Management",
    content: `You have full control over your account:

• You can update your profile name and photo at any time from the Profile page
• You can delete your account and all associated data at any time from Profile → Delete Account
• Account deletion removes all personal data, fitness logs, progress photos, AI plans, check-ins, and nutrition records
• Deleted data cannot be recovered
• If you have an active subscription, cancelling your account does not automatically cancel billing — please cancel your subscription first`,
  },
  {
    title: "Your Rights",
    content: `Depending on your location, you may have the right to:

• Access the personal data we hold about you
• Request correction of inaccurate data
• Request deletion of your data (available directly in-app via Profile → Delete Account)
• Object to or restrict certain types of processing
• Data portability (receive your data in a structured format)

To exercise any of these rights, contact us at privacy@goatwalk.app. We will respond within 30 days.`,
  },
  {
    title: "Data Security",
    content: `We take security seriously:

• All data is transmitted over HTTPS
• Data is stored in secure cloud infrastructure with access controls
• Progress photos are stored with private access URLs
• We do not sell your personal data to third parties
• In the event of a data breach, we will notify affected users in accordance with applicable law`,
  },
  {
    title: "Contact Us",
    content: `If you have questions about this Privacy Policy or how your data is handled, contact us at:

privacy@goatwalk.app

This policy was last updated: July 2025`,
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-10 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-5 h-5 text-primary" />
          <p className="text-muted-foreground text-sm uppercase tracking-widest">Legal</p>
        </div>
        <h1 className="text-3xl font-black tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">Last updated: July 2025</p>
      </div>

      {/* Intro */}
      <Card className="border-primary/20 bg-primary/4">
        <CardContent className="p-4 text-sm text-muted-foreground leading-relaxed">
          GOAT WALK is committed to protecting your privacy. This policy explains what data we collect, how we use it, and your rights as a user.
        </CardContent>
      </Card>

      {/* Sections */}
      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <Card key={section.title} className="border-border bg-card">
            <CardContent className="p-5">
              <h2 className="font-bold text-base mb-3">{section.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{section.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Link to Terms */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground">Also read our Terms of Service</p>
        <Link to="/terms" className="flex items-center gap-1 text-xs text-primary font-medium cursor-pointer hover:underline">
          Terms of Service <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
