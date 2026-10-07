import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import gamesRouter from "./games";
import walletRouter from "./wallet";
import withdrawalRouter from "./withdrawals";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(gamesRouter);
router.use(walletRouter);
router.use(withdrawalRouter);

export default router;
