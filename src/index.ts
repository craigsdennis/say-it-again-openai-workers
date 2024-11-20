// Copyright (c) 2024 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE file or at https://opensource.org/licenses/MIT

import { Hono } from "hono";
import { jwt, JwtVariables, sign } from "hono/jwt";
import { RealtimeClient } from "@openai/realtime-api-beta";
import { HTTPException } from "hono/http-exception";
import { setCookie } from "hono/cookie";

type Variables = JwtVariables;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEBUG = false; // set as true to see debug logs
const MODEL = "gpt-4o-realtime-preview-2024-10-01";
const OPENAI_URL = "wss://api.openai.com/v1/realtime";

function owrLog(...args: unknown[]) {
  if (DEBUG) {
    console.log("[owr]", ...args);
  }
}

function owrError(...args: unknown[]) {
  console.error("[owr error]", ...args);
}

async function createRealtimeClient(
  request: Request,
  env: Env,
  ctx: ExecutionContext
) {
  const webSocketPair = new WebSocketPair();
  const [clientSocket, serverSocket] = Object.values(webSocketPair);

  serverSocket.accept();

  // Copy protocol headers
  const responseHeaders = new Headers();
  const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
  let apiKey = env.OPENAI_API_KEY;
  if (protocolHeader) {
    const requestedProtocols = protocolHeader.split(",").map((p) => p.trim());
    if (requestedProtocols.includes("realtime")) {
      // Not exactly sure why this protocol needs to be accepted
      responseHeaders.set("Sec-WebSocket-Protocol", "realtime");
    }
  }

  if (!apiKey) {
    owrError(
      "Missing OpenAI API key. Did you forget to set OPENAI_API_KEY in .dev.vars (for local dev) or with wrangler secret put OPENAI_API_KEY (for production)?"
    );
    return new Response("Missing API key", { status: 401 });
  }

  let realtimeClient: RealtimeClient | null = null;

  // Create RealtimeClient
  try {
    owrLog("Creating OpenAIRealtimeClient");
    realtimeClient = new RealtimeClient({
      apiKey,
      debug: DEBUG,
      url: OPENAI_URL,
    });
  } catch (e) {
    owrError("Error creating OpenAI RealtimeClient", e);
    serverSocket.close();
    return new Response("Error creating OpenAI RealtimeClient", {
      status: 500,
    });
  }

  // Relay: OpenAI Realtime API Event -> Client
  realtimeClient.realtime.on("server.*", (event: { type: string }) => {
    serverSocket.send(JSON.stringify(event));
  });

  realtimeClient.realtime.on("close", (metadata: { error: boolean }) => {
    owrLog(
      `Closing server-side because I received a close event: (error: ${metadata.error})`
    );
    serverSocket.close();
  });

  // Relay: Client -> OpenAI Realtime API Event
  const messageQueue: string[] = [];

  serverSocket.addEventListener("message", (event: MessageEvent) => {
    const messageHandler = (data: string) => {
      try {
        const parsedEvent = JSON.parse(data);
        realtimeClient.realtime.send(parsedEvent.type, parsedEvent);
      } catch (e) {
        owrError("Error parsing event from client", data);
      }
    };

    const data =
      typeof event.data === "string" ? event.data : event.data.toString();
    if (!realtimeClient.isConnected()) {
      messageQueue.push(data);
    } else {
      messageHandler(data);
    }
  });

  serverSocket.addEventListener("close", ({ code, reason }) => {
    owrLog(
      `Closing server-side because the client closed the connection: ${code} ${reason}`
    );
    realtimeClient.disconnect();
    messageQueue.length = 0;
  });

  let model: string | undefined = MODEL;

  // uncomment this to use a model from specified by the client

  // const modelParam = new URL(request.url).searchParams.get("model");
  // if (modelParam) {
  //   model = modelParam;
  // }

  // Connect to OpenAI Realtime API
  try {
    owrLog(`Connecting to OpenAI...`);
    // @ts-expect-error Waiting on https://github.com/openai/openai-realtime-api-beta/pull/52
    await realtimeClient.connect({ model });
    owrLog(`Connected to OpenAI successfully!`);
    while (messageQueue.length) {
      const message = messageQueue.shift();
      if (message) {
        serverSocket.send(message);
      }
    }
  } catch (e) {
    owrError("Error connecting to OpenAI", e);
    return new Response("Error connecting to OpenAI", { status: 500 });
  }

  return new Response(null, {
    status: 101,
    headers: responseHeaders,
    webSocket: clientSocket,
  });
}

app.use("/auth/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET,
    cookie: "jwtPayload",
  });
  return jwtMiddleware(c, next);
});

app.onError(async (err, c) => {
  console.error(err);
  if (err instanceof HTTPException) {
    const res = err.getResponse();
    if (res.status === 401) {
      return c.redirect(`/login`);
    }
  }
  return new Response(err.message);
});

app.post("/authenticate", async (c) => {
  const body = await c.req.parseBody();
  // TODO: Use D1 to store users and passwords
  if (body.username === "cloud" && body.password === "flare") {
    const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
    const expiresDate = new Date();
    expiresDate.setTime(expiresDate.getTime() + expires);
    const payload = {
      sub: body.username,
      role: "user",
      exp: expires,
    };
    const jwt = await sign(payload, c.env.JWT_SECRET);
    setCookie(c, "jwtPayload", jwt, { expires: expiresDate });
    return c.redirect("/");
  }
  const message = "Invalid login, try again";
  // TODO: Show the message if it exists
  return c.redirect(`/login?message=${encodeURIComponent(message)}`);
});

app.get("/auth/check", async (c) => {
  console.log("This will be blocked unless user is authenticated");
  const jwt = c.get("jwtPayload");
  return c.json({ success: true, loggedInAs: jwt.sub });
});

app.get("/auth/ws", async (c) => {
  // This would be a good place to add logic for rate limiting, etc.
  const jwt = c.get("jwtPayload");
  console.log("jwt", jwt);
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader === "websocket") {
    return createRealtimeClient(c.req.raw, c.env, c.executionCtx);
  }
  return new Response("Expected Upgrade: websocket", { status: 426 });
});

export default app;
