import { Router, type IRouter } from "express";
import healthRouter from "./health";
import paypilotRouter from "./paypilot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(paypilotRouter);

export default router;
