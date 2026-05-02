import { Router, type IRouter } from "express";
import healthRouter from "./health";
import summaryRouter from "./summary";
import armsRouter from "./arms";
import tasksRouter from "./tasks";
import signalsRouter from "./signals";
import memoryRouter from "./memory";
import logsRouter from "./logs";
import adaptersRouter from "./adapters";
import resonanceRouter from "./resonance";
import demoRouter from "./demo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(summaryRouter);
router.use(armsRouter);
router.use(tasksRouter);
router.use(signalsRouter);
router.use(memoryRouter);
router.use(logsRouter);
router.use(adaptersRouter);
router.use(resonanceRouter);
router.use(demoRouter);

export default router;
