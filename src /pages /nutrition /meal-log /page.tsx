import { Authenticated } from "convex/react";
import { Button } from "@/components/ui/button.tsx";
import { Camera } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";

export default function MealLogPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center"
        >
          <div className="p-4 bg-green-500/10 rounded-2xl">
            <Camera className="w-10 h-10 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2">AI Meal Logging</h1>
            <p className="text-muted-foreground text-sm max-w-sm">
              Log your meals directly from your Nutrition Calendar. Select any meal on today's calendar and tap "Log this meal" to upload a photo and get AI macro analysis.
            </p>
          </div>
          <Button asChild className="cursor-pointer">
            <Link to="/calendar">Go to Nutrition Calendar</Link>
          </Button>
        </motion.div>
      </div>
    </Authenticated>
  );
}
