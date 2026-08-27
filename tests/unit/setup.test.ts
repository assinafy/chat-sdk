import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../setup.js";

const originalBaseUrl = process.env.ASSINAFY_BASE_URL;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.ASSINAFY_BASE_URL;
  else process.env.ASSINAFY_BASE_URL = originalBaseUrl;
});

describe("live test configuration", () => {
  it("refuses to send sandbox credentials to another origin", () => {
    process.env.ASSINAFY_BASE_URL = "https://example.test/v1";
    expect(() => loadEnv()).toThrow("Live tests require ASSINAFY_BASE_URL");
  });
});
