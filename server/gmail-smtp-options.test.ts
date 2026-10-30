import { describe, expect, it } from "vitest";
import { gmailSmtpTransportOptions } from "./auth";

describe("Gmail SMTP transport configuration", () => {
  it("uses STARTTLS on smtp.gmail.com:587 and removes App Password grouping spaces", () => {
    expect(gmailSmtpTransportOptions("jeffomullo559@gmail.com", "abcd efgh ijkl mnop")).toEqual({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "jeffomullo559@gmail.com", pass: "abcdefghijklmnop" },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  });

  it("rejects an invalid account address or empty App Password", () => {
    expect(() => gmailSmtpTransportOptions("not-gmail@example.com", "abcdefghijklmnop")).toThrowError();
    expect(() => gmailSmtpTransportOptions("jeffomullo559@gmail.com", "   ")).toThrowError();
  });
});
