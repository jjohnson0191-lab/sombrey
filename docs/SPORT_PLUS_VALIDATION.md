# Sport+ band import — physical-band validation

What's implemented is SDK capability. Nothing here counts as a confirmed physical-band capability until these steps pass on a real Sombrey Band.

**Where to check.** Train › Workout history › **Sync band activities** shows the last import's result. Tapping a band session opens its detail view, which lists every field and marks unreported ones "Not measured". Its **SOURCE** group shows the band's raw start time and raw duration exactly as the SDK returned them. Debug builds also have Settings › Developer › Wearable diagnostics › SPORT+ IMPORT, which shows the raw records and every data-update report type the band sends.

| # | Test | Pass when |
|---|---|---|
| 1–3 | Start a Sport+ activity on the band (e.g. Tennis), do ~5 real minutes, end it | — |
| 4 | Open Sombrey (or tap Sync band activities) | Last band sync shows "1 new" |
| 5 | Session appears in Workout history | Listed as BAND · SPORT+ |
| 6 | Activity type | The session's name matches what you chose on the band (e.g. "Tennis") |
| 7 | Start time & duration | Start matches your watch to the minute. Duration matches, confirming the raw duration is seconds. If start is off by whole hours or flagged "time looks wrong", the band's epoch/timezone differs from UTC; record the offset |
| 8 | Heart rate | Lowest/Average/Highest shown, and plausible for the effort |
| 9 | Calories | Plausible kcal for ~5 min (not ×1000) |
| 10 | Distance / steps | Present for step-based sports (run/walk); "Not measured" where the band doesn't measure them |
| 11 | Missing fields | Unreported fields read "Not measured", never 0 |
| 12 | No duplicates | Sync again: "0 new · 1 matched…" and still one entry |
| 13 | Survives restart | Force-quit and reopen: still there |
| 14 | Second session | A second band session imports as its own entry |
| 15 | While app closed | Do a session with Sombrey closed, then open it: imported on first sync |
| + | App-started session | Start Sport+ from Train, stop it. After ~10 s the entry reads "Started from Sombrey, recorded by the band", with heart-rate stats from the band's record, and one entry, not two |
| + | Band report | In diagnostics, "dataUpdateReports" includes `7×n` if the band sends the Sport+ record report |

## Train › Activity (app-started activity)

A short, controlled session is enough; the heart-rate and calorie values from a mostly stationary test are **not** meaningful sport measurements.

| # | Test | Pass when |
|---|---|---|
| A1 | Train › ACTIVITY, choose Tennis, tap **Start Tennis** with the band connected | The live screen opens; the band enters its Tennis mode. If the band refuses, the hero says so, and nothing is recorded as started |
| A2 | Live screen for ~3 min | Clock runs; heart rate shows with "LIVE"-fresh values; steps, energy etc. fill in only once the band reports them ("Waiting for the band", never 0) |
| A3 | Pause 30 s, resume | Clock stops while paused; the band pauses too |
| A4 | Force-quit the app mid-session, reopen | The live screen returns, clock still running (minus the pause); **End** still stops the band |
| A5 | **End** | Summary shows duration ("timed by Sombrey" until the band record arrives), then within ~10–60 s "Recorded by your band" with avg/peak heart rate |
| A6 | Compare with the band | Duration and calories match the band's own session screen |
| A7 | Train › ACTIVITY again | Tennis is first in "Recent"; "Your Tennis" shows 1 session |
| A8 | Sync band activities (Workout history) twice | Still exactly one Tennis session (the app row and the band record merged) |
| A9 | Intensity | With a date of birth on the account, the summary shows a zone labelled "estimated from your age"; without one, no intensity label appears |
| A10 | Noticed activity | After ≥20 min of genuinely elevated heart rate without starting anything, Train › ACTIVITY asks "What were you doing?"; naming it adds it to that activity's history; "Not an activity" makes it go away for good |

Record results here, per sport tested, before treating any capability as confirmed:

| Capability | SDK | Physical band (result, date) |
|---|---|---|
| History fetch (`getSportRecordsFromLastTimeStamp`) | yes | |
| Start time is Unix epoch UTC | undocumented | |
| Duration unit is seconds | undocumented | |
| Min/avg/max HR in record | yes | |
| Calories in record | yes | |
| Distance / steps per sport | yes (generic) | |
| Heart-rate / speed series (detail) | yes | |
| GPS in band record | yes (header) | |
| New-record report (type 7) | yes | |
| App-started Sport+ (`operateSportMode…`) | yes; demo says "ring only" | |
