---
npm/@idlekit/core: minor
npm/@idlekit/cli: minor
---

Parameter experiments support `timeToMilestone` with an exact `milestoneKey` for first-prestige and unlock timing, including objectives, deadline constraints, and local sensitivity. The metric reads committed observations independently of retained logs and wallet resets, leaves unreached progress censored, and records the selected key in the artifact. Reach-time metrics now use elapsed committed ticks, avoiding duration rounding at large absolute state clocks. Action-derived milestones preserve tick-start timing, so an initial purchase reaches at zero seconds without a false deadline violation. Milestone observer facts include their committed phase to preserve tick-end timing even when a final partial tick cannot advance the absolute clock.
