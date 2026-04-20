import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import storefrontRouter from "./storefront";
import checkoutRouter from "./checkout";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(storefrontRouter);
router.use(checkoutRouter);

export default router;
