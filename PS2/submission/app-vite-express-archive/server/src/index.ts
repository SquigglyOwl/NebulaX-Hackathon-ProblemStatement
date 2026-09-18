import "dotenv/config";
import cors from "cors";
import express from "express";
import { warmAlternatesCache } from "./alternates.js";
import { startCrowdingPolling } from "./crowding.js";
import { warmPvTrainBaseline } from "./pvTrainBaseline.js";
import { router } from "./routes.js";
import { startPolling } from "./state.js";
import { warmWalkRoutes } from "./walkRouting.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", router);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`server listening on :${port}`);
  startPolling();
  warmAlternatesCache();
  startCrowdingPolling();
  warmWalkRoutes();
  warmPvTrainBaseline();
});
