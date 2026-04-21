import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { createProxyMiddleware } from "http-proxy-middleware";

const app: Express = express();

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

// Clerk proxy must be mounted BEFORE body parsers — it streams raw bytes.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clerk session middleware — populates `getAuth(req)` for downstream routes.
app.use(clerkMiddleware());

// Existing Replit-Auth middleware for the legacy admin auth flow.
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
