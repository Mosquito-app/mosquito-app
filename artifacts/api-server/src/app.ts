import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { unityCors } from "./lib/unity-auth";

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
app.use("/api/match", unityCors);
app.use((req, res, next) => {
  if (res.locals.unityCors) { next(); return; }
  cors()(req, res, next);
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
const handleError: ErrorRequestHandler = (_error, req, res, _next) => {
  req.log.error("Unhandled API request failure");
  if (!res.headersSent) res.status(500).json({ error: "The request could not be completed." });
};
app.use(handleError);

export default app;
