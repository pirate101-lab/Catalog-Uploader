import { Router, type IRouter } from "express";
import healthRouter from "./health.ts";
import authRouter from "./auth.ts";
import adminAuthRouter from "./adminAuth.ts";
import adminUsersRouter from "./adminUsers.ts";
import storageRouter from "./storage.ts";
import storefrontRouter from "./storefront.ts";
import checkoutRouter from "./checkout.ts";
import paymentsRouter from "./payments.ts";
import adminRouter from "./admin.ts";
import addressesRouter from "./addresses.ts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(adminAuthRouter);
router.use(adminUsersRouter);
router.use(storageRouter);
router.use(storefrontRouter);
router.use(checkoutRouter);
router.use(paymentsRouter);
router.use(adminRouter);
router.use(addressesRouter);

export default router;
