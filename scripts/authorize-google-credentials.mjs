#!/usr/bin/env node

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { OAuth2Client } from "google-auth-library";

const usage =
  "Usage: authorize-google-credentials.mjs --surface <calendar|tasks> --role <read|write> --client <path> --scopes <comma-separated> --output <path>";

try {
  const arguments_ = parseArguments(process.argv.slice(2));
  await authorize(arguments_);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    }
    if (!argument.startsWith("--")) throw new Error(usage);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(usage);
    values.set(argument, value);
    index += 1;
  }
  const surface = values.get("--surface");
  const role = values.get("--role");
  const clientPath = values.get("--client");
  const scopes = values.get("--scopes");
  const outputPath = values.get("--output");
  if (
    (surface !== "calendar" && surface !== "tasks") ||
    (role !== "read" && role !== "write") ||
    clientPath === undefined ||
    scopes === undefined ||
    outputPath === undefined
  ) {
    throw new Error(usage);
  }
  return {
    surface,
    role,
    clientPath,
    scopes: scopes.split(",").filter(Boolean),
    outputPath,
  };
}

async function authorize({ surface, role, clientPath, scopes, outputPath }) {
  const client = await readClient(clientPath);
  const server = createServer();
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine the OAuth loopback port.");
  }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const oauth = new OAuth2Client({
    clientId: client.client_id,
    clientSecret: client.client_secret,
    redirectUri,
  });
  const { codeVerifier, codeChallenge } =
    await oauth.generateCodeVerifierAsync();
  const state = randomUUID();
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: "offline",
    client_id: client.client_id,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: false,
    prompt: "consent",
    scope: scopes,
    state,
  });

  process.stdout.write(
    `Starting ${role} ${surface} OAuth approval. Requested scopes: ${scopes.join(", ")}\n`,
  );
  process.stdout.write("Opening the approval page in the default browser.\n");
  openBrowser(authorizationUrl);
  process.stdout.write(
    "If the browser did not open, copy the printed URL from the next line into it.\n",
  );
  process.stdout.write(`${authorizationUrl}\n`);

  try {
    const tokens = await receiveAuthorizationCode({
      oauth,
      server,
      state,
      codeVerifier,
    });
    assertGrantedScopes(tokens.scope, scopes);
    await writeAuthorizedUserCredential({
      client,
      outputPath,
      refreshToken: tokens.refresh_token,
    });
    process.stdout.write(`Stored ${role} ${surface} credential.\n`);
  } finally {
    server.close();
  }
}

async function readClient(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  const installed = value?.installed;
  if (
    installed === null ||
    typeof installed !== "object" ||
    typeof installed.client_id !== "string" ||
    typeof installed.client_secret !== "string"
  ) {
    throw new Error(
      `OAuth client file is not an installed-app client: ${path}`,
    );
  }
  return installed;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function receiveAuthorizationCode({ oauth, server, state, codeVerifier }) {
  return new Promise((resolve, reject) => {
    server.on("request", async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1/");
      if (requestUrl.pathname !== "/oauth2callback") {
        response.writeHead(404);
        response.end("Not found.");
        return;
      }
      if (requestUrl.searchParams.get("state") !== state) {
        response.writeHead(400);
        response.end("OAuth state mismatch. You may close this tab.");
        reject(new Error("OAuth state mismatch."));
        return;
      }
      const error = requestUrl.searchParams.get("error");
      if (error !== null) {
        response.writeHead(400);
        response.end(
          "Google denied the requested access. You may close this tab.",
        );
        reject(new Error(`Google OAuth was not approved: ${error}.`));
        return;
      }
      const code = requestUrl.searchParams.get("code");
      if (code === null) {
        response.writeHead(400);
        response.end(
          "OAuth response did not contain a code. You may close this tab.",
        );
        reject(
          new Error(
            "Google OAuth response did not contain an authorization code.",
          ),
        );
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<p>Authorization complete. You may close this tab and return to the terminal.</p>",
      );
      try {
        const tokenResponse = await oauth.getToken({ code, codeVerifier });
        const tokens = tokenResponse.tokens;
        if (typeof tokens.refresh_token !== "string") {
          reject(
            new Error(
              "Google returned no refresh token. Re-run the flow and approve consent when prompted.",
            ),
          );
          return;
        }
        resolve(tokens);
      } catch (error_) {
        reject(error_);
      }
    });
  });
}

function assertGrantedScopes(grantedScope, requestedScopes) {
  const granted = new Set(
    typeof grantedScope === "string" ? grantedScope.split(" ") : [],
  );
  const missing = requestedScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new Error(
      `Google did not grant the requested scope(s): ${missing.join(", ")}.`,
    );
  }
}

async function writeAuthorizedUserCredential({
  client,
  outputPath,
  refreshToken,
}) {
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await access(dirname(outputPath));
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  const credential = {
    type: "authorized_user",
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: refreshToken,
  };
  try {
    await writeFile(temporaryPath, `${JSON.stringify(credential, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Preserve the original error; the temporary file is private and exact.
    }
    throw error;
  }
}

function openBrowser(url) {
  const commands =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd.exe", ["/c", "start", "", url]]]
        : [
            ["xdg-open", [url]],
            ["wslview", [url]],
          ];
  for (const [command, arguments_] of commands) {
    try {
      const child = spawn(command, arguments_, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return;
    } catch {
      // Try the next platform opener, then leave the URL on stdout.
    }
  }
}
