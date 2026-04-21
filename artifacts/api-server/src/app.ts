import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
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

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
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
