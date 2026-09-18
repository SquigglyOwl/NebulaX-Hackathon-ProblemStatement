import { Router } from "express";
import { clearMock, currentStatus, injectMock } from "./state.js";

export const router = Router();

router.get("/status", (_req, res) => {
  res.json(currentStatus());
});

// Demo-only: simulate a disruption since TrainServiceAlerts.AffectedSegments is
// empty on an ordinary day (PS2_README §2.6). Labelled via `source: "mock"` in
// /api/status so it is never mistaken for live data.
router.post("/mock/inject", (req, res) => {
  const { severity, stationCodes, freeMRTShuttle, freePublicBus, message, minutesActive } = req.body ?? {};
  if (![1, 2].includes(severity) || !Array.isArray(stationCodes) || stationCodes.length === 0) {
    return res.status(400).json({ error: "severity (1|2) and non-empty stationCodes[] are required" });
  }
  injectMock({ severity, stationCodes, freeMRTShuttle, freePublicBus, message, minutesActive });
  res.json(currentStatus());
});

router.post("/mock/clear", (_req, res) => {
  clearMock();
  res.json(currentStatus());
});
