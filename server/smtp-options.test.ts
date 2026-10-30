import { describe, expect, it } from "vitest";
import { smtpTransportOptions } from "./auth";

describe("SMTP URL conversion for Nodemailer", () => {
  it("decodes Gmail credentials and requires TLS on port 587", () => {
    expect(smtpTransportOptions("smtp://jeff%40gmail.com:app%40pass%3Fword@smtp.gmail.com:587")).toEqual({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "jeff@gmail.com", pass: "app@pass?word" },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  });

  it("defaults implicit SMTPS URLs to secure port 465", () => {
    const options = smtpTransportOptions("smtps://user%40example.com:app-password@mail.example.com");
    expect(options).toMatchObject({ host: "mail.example.com", port: 465, secure: true, requireTLS: false });
  });

  it("rejects missing credentials, non-SMTP schemes, malformed values, query strings and fragments", () => {
    for (const value of [
      "smtp://smtp.gmail.com:587",
      "https://user:pass@smtp.gmail.com",
      "not-a-url",
      "smtp://user:pass@smtp.gmail.com:587?debug=1",
      "smtp://user:pass@smtp.gmail.com:587#fragment",
    ]) {
      expect(() => smtpTransportOptions(value)).toThrowError();
    }
  });
});
