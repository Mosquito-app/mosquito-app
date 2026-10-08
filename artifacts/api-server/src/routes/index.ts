import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import gamesRouter from "./games";
import walletRouter from "./wallet";
import footballRouter from "./football";
import withdrawalRouter from "./withdrawals";
import unityMatchRouter from "./unity-match";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(gamesRouter);
router.use(walletRouter);
router.use(footballRouter);
router.use(withdrawalRouter);
router.use(unityMatchRouter);

export default router;
