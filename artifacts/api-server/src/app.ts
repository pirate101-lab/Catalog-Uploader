import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes/index.ts";
import { logger } from "./lib/logger.ts";
import { authMiddleware } from "./middlewares/authMiddleware.ts";
import { createProxyMiddleware } from "http-proxy-middleware";

const app: Express = express();
// Trust the Replit edge proxy so req.protocol/req.hostname reflect the
// public origin (https + custom domain) rather than the internal port.
// This makes /admin/payments/urls report the URL operators actually need
// to paste into the Paystack dashboard.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
// Paystack webhook MUST receive the raw, unparsed body so we can verify
// the HMAC signature byte-for-byte. Mount the raw parser before
// express.json() so json() sees `req._body=true` and skips it.
app.use(
  "/api/payments/paystack/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware — populates req.user for both OIDC (admin) and
// password-based (storefront) sessions stored in the sessions table.
app.use(authMiddleware);

app.use("/api", router);

if (process.env.NODE_ENV !== "production") {
  const viteProxy = createProxyMiddleware({
    target: "http://127.0.0.1:25245",
    changeOrigin: true,
    ws: true,
    logger: console,
  });
  app.use("/", viteProxy);
}

export default app;
