import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import storefrontRouter from "./storefront";
import checkoutRouter from "./checkout";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(storefrontRouter);
router.use(checkoutRouter);
router.use(adminRouter);

export default router;
