import { Hono } from "hono";
import type { Env } from "./types";
import { cors } from "./middleware/cors";
import { auth } from "./middleware/auth";
import { rateLimit } from "./middleware/rate-limit";
import chatRoutes from "./routes/chat";
import providerRoutes from "./routes/providers";
import tokenRoutes from "./routes/token";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors);

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.route("/api/token", tokenRoutes);

app.use("/api/*", auth);
app.use("/api/chat/*", rateLimit);

app.route("/api/chat", chatRoutes);
app.route("/api/providers", providerRoutes);

export default app;
