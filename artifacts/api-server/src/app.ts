import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rawBody from "raw-body"; // needed for PayPal webhook signature verification
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? process.env.PAYPILOT_APP_ORIGIN ?? "http://localhost:23943,http://127.0.0.1:23943")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use(cors({
  origin(origin, callback) {
    // Non-browser clients commonly omit Origin. Browser origins must be explicitly allowed.
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

app.use("/api", router);

// Keep unexpected exceptions from leaking stack traces or provider diagnostics to clients.
function safeErrorSummary(error: unknown): { name: string; code?: string; message: string } {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: "A non-Error value was thrown" };
  }
  const candidate = error as Error & { code?: unknown };
  const message = error.message
    .replace(/:\/\/[^/@\s]+@/g, "://[redacted]@")
    .replace(/(password|secret|token|authorization)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]");
  return {
    name: error.name,
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    message: message.slice(0, 500),
  };
}

app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  req.log.error({ error: safeErrorSummary(error) }, "Unhandled API request error");
  res.status(500).json({
    error: "An unexpected server error occurred. No payment success is implied; check the order status before retrying.",
  });
});

export default app;
