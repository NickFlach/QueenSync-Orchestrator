import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import summaryRouter from "./summary";
import armsRouter from "./arms";
import tasksRouter from "./tasks";
import signalsRouter from "./signals";
import memoryRouter from "./memory";
import logsRouter from "./logs";
import adaptersRouter from "./adapters";
import observatoryRouter from "./observatory";
import resonanceRouter from "./resonance";
import demoRouter from "./demo";
import { requireViewer } from "../lib/auth";

const router: IRouter = Router();

// Always-public: health check and auth endpoints (login must be reachable).
router.use(healthRouter);
router.use(authRouter);

// Read-mostly routers. Mutations inside these are individually wrapped with
// requireOperator. List/GET endpoints additionally pass through requireViewer
// which is a no-op unless QUEENSYNC_REQUIRE_AUTH_FOR_READS is set.
router.use(requireViewer, summaryRouter);
router.use(requireViewer, armsRouter);
router.use(requireViewer, tasksRouter);
router.use(requireViewer, signalsRouter);
router.use(requireViewer, memoryRouter);
router.use(requireViewer, logsRouter);
router.use(requireViewer, adaptersRouter);
router.use(requireViewer, observatoryRouter);
router.use(requireViewer, resonanceRouter);
router.use(requireViewer, demoRouter);

export default router;
