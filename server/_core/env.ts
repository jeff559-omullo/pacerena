// Platform values are read at use time. See the Webdev service/authentication skills.
export const ENV = {
  get appId() { return process.env.MANUS_PROJECT_ID ?? ""; },
  get cookieSecret() { return process.env.MANUS_JWT_SECRET ?? ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get oAuthServerUrl() { return process.env.MANUS_OAUTH_API_URL ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
  get paceSmtpUrl() { return process.env.PACE_SMTP_URL ?? ""; },
  get paceSmtpUsername() { return process.env.PACE_SMTP_USERNAME ?? ""; },
  get paceSmtpAppPassword() { return process.env.PACE_SMTP_APP_PASSWORD ?? ""; },
  get paceSmtpFrom() { return process.env.PACE_SMTP_FROM ?? ""; },
};
