/**
 * Static OpenAPI 3.0 spec for the Maximilian API.
 *
 * Covers the main user-facing endpoints. Operational endpoints
 * (/api/metrics) are excluded. The spec is served at:
 *   - /api/openapi.json — raw JSON
 *   - /api/docs         — Swagger UI
 *
 * For simplicity, this spec is hand-maintained rather than generated
 * from route definitions. Update this file when route signatures change.
 */

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Maximilian API",
    version: "0.1.0",
    description:
      "Meta-agent OS API. Submit user requests, observe execution, manage governance.",
  },
  servers: [
    { url: "/api", description: "Current host (no version prefix)" },
    { url: "/api/v1", description: "Versioned" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token from /auth/login",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          details: {},
        },
        required: ["error"],
      },
      Health: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok", "degraded"] },
          providers: { type: "array", items: { $ref: "#/components/schemas/Provider" } },
          defaultProvider: { type: "string" },
          evolution: { type: "string" },
          dagsMode: { type: "string" },
          metaAgent: { type: "string" },
          telemetry: { type: "string" },
          multiTenant: { type: "string" },
          database: { type: "string" },
        },
      },
      Provider: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
      Ready: {
        type: "object",
        properties: {
          ready: { type: "boolean" },
          database: { type: "boolean" },
          redis: { type: "boolean" },
        },
      },
      AuthRegister: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          displayName: { type: "string" },
          tenantName: { type: "string" },
        },
      },
      AuthLogin: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      AuthTokens: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          expiresIn: { type: "integer" },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", minLength: 1 },
        },
      },
      ChatResponse: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
        },
      },
      Workspace: {
        type: "object",
        properties: {
          id: { type: "string" },
          userRequest: { type: "string" },
          status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
          plan: {},
          results: { type: "array" },
          review: {},
          error: { type: "string", nullable: true },
        },
      },
      Tenant: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          slug: { type: "string" },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Proposal: {
        type: "object",
        properties: {
          proposalId: { type: "string" },
          proposal: { type: "object" },
          simulation: { type: "object" },
          score: { type: "object" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        description: "Returns backend health, providers, and module status. Used for liveness probes.",
        responses: {
          "200": {
            description: "Healthy or degraded (still returns 200 with status field)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
          },
        },
      },
    },
    "/ready": {
      get: {
        summary: "Readiness check",
        description: "Returns 200 only when all critical dependencies (DB, Redis) are reachable. Used for K8s readiness probes.",
        responses: {
          "200": {
            description: "Ready",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ready" } } },
          },
          "503": {
            description: "Not ready",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/providers": {
      get: {
        summary: "List LLM providers",
        responses: {
          "200": {
            description: "Provider list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { providers: { type: "array", items: { $ref: "#/components/schemas/Provider" } } },
                },
              },
            },
          },
        },
      },
    },
    "/auth/register": {
      post: {
        summary: "Register new user",
        description: "Creates a user (and a tenant if tenantName provided). Returns JWT tokens.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AuthRegister" } } },
        },
        responses: {
          "200": {
            description: "Registered",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthTokens" } } },
          },
          "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "Email already registered" },
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "Log in",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AuthLogin" } } },
        },
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthTokens" } } },
          },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        summary: "Refresh access token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refreshToken"],
                properties: { refreshToken: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthTokens" } } },
          },
          "401": { description: "Invalid refresh token" },
        },
      },
    },
    "/auth/logout": {
      post: {
        summary: "Log out (invalidate refresh token)",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "OK" },
          "401": { description: "Unauthenticated" },
        },
      },
    },
    "/chat": {
      post: {
        summary: "Submit user request",
        description: "Commander plans tasks and dispatches agents. Returns the workspace ID for polling.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ChatRequest" } } },
        },
        responses: {
          "200": {
            description: "Workspace created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ChatResponse" } } },
          },
          "401": { description: "Unauthenticated" },
        },
      },
    },
    "/workspaces": {
      get: {
        summary: "List workspaces",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/Workspace" } },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/workspaces/{id}": {
      get: {
        summary: "Get workspace",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Workspace" } } },
          },
          "404": { description: "Not found" },
        },
      },
    },
    "/workspaces/{id}/events": {
      get: {
        summary: "Get workspace runtime events",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
    },
    "/tenants": {
      get: {
        summary: "List tenants (admin only)",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { tenants: { type: "array", items: { $ref: "#/components/schemas/Tenant" } } } },
              },
            },
          },
          "403": { description: "Admin role required" },
        },
      },
      post: {
        summary: "Create tenant (admin only)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Created" }, "403": { description: "Admin role required" } },
      },
    },
    "/tenants/{id}": {
      get: { summary: "Get tenant", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
      put: { summary: "Update tenant", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
      delete: { summary: "Delete tenant", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
    },
    "/gov/pending": {
      get: {
        summary: "List pending governance proposals",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { proposals: { type: "array", items: { $ref: "#/components/schemas/Proposal" } } } },
              },
            },
          },
        },
      },
    },
    "/gov/proposals/{id}/action": {
      post: {
        summary: "Approve or reject a proposal",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
      },
    },
    "/evolution/metrics": {
      get: { summary: "List evolution metrics", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
    },
    "/evolution/agents": {
      get: { summary: "List agent manifests", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
    },
    "/executions": {
      get: { summary: "List execution traces", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
    },
    "/executions/{id}": {
      get: { summary: "Get execution trace", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
    },
    "/meta/capabilities": {
      get: { summary: "List capabilities", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } },
    },
  },
} as const;
