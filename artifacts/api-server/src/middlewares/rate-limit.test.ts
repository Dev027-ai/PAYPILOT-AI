import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { createRateLimiter } from "./rate-limit";

function makeRequest(ip: string): Request {
  return { ip, socket: { remoteAddress: ip } } as unknown as Request;
}

function makeResponse() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

describe("createRateLimiter", () => {
  it("allows requests up to the configured limit and rejects the next request", () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 2, message: "Slow down" });
    const next = vi.fn() as unknown as NextFunction;

    limit(makeRequest("127.0.0.1"), makeResponse(), next);
    limit(makeRequest("127.0.0.1"), makeResponse(), next);
    const response = makeResponse();
    limit(makeRequest("127.0.0.1"), response, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({ error: "Slow down" });
  });

  it("keeps separate buckets per client IP", () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 1, message: "Slow down" });
    const next = vi.fn() as unknown as NextFunction;
    limit(makeRequest("192.0.2.1"), makeResponse(), next);
    const secondClientResponse = makeResponse();
    limit(makeRequest("192.0.2.2"), secondClientResponse, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(secondClientResponse.status).not.toHaveBeenCalled();
  });
});
