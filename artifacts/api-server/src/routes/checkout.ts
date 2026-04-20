import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

router.post("/checkout/intent", (_req: Request, res: Response) => {
  res.status(503).json({
    error: "Payments are not configured for this storefront.",
    paymentsConfigured: false,
  });
});

router.post("/checkout/confirm", (_req: Request, res: Response) => {
  res.status(503).json({
    error: "Payments are not configured for this storefront.",
    paymentsConfigured: false,
  });
});

export default router;
