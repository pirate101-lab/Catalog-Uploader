import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import storefrontRouter from "./storefront";
import checkoutRouter from "./checkout";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import addressesRouter from "./addresses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(storefrontRouter);
router.use(checkoutRouter);
router.use(paymentsRouter);
router.use(adminRouter);
router.use(addressesRouter);

export default router;
