# Sport+ band import — physical-band validation

What's implemented is SDK capability. Nothing here counts as a confirmed physical-band capability until these steps pass on a real Sombrey Band.

**Where to check.** Train › Workout history › **Sync band activities** shows the last import's result. Tapping a band session opens its detail view, which lists every field and marks unreported ones "Not measured". Its **SOURCE** group shows the band's raw start time and raw duration exactly as the SDK returned them. Debug builds also have Settings › Developer › Wearable diagnostics › SPORT+ IMPORT, which shows the raw records and every data-update report type the band sends.

| # | Test | Pass when |
|---|---|---|
| 1–3 | Start a Sport+ activity on the band (e.g. Tennis), do ~5 real minutes, end it | — |
| 4 | Open Sombrey (or tap Sync band activities) | Last band sync shows "1 new" |
| 5 | Session appears in Workout history | Listed as BAND · SPORT+ |
| 6 | Activity type | Title and "Sport+ <id>" match what you chose on the band |
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
