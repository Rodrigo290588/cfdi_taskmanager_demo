module.exports = {
  apps: [
    {
      name: "cfdi-taskmanager",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "",
        REDIS_URL: "",
        MASS_DOWNLOADS_REDIS_REQUIRE_AUTH: "true",
        NEXTAUTH_SECRET: "",
        INVOICE_XML_ENCRYPTION_KEY: process.env.INVOICE_XML_ENCRYPTION_KEY,
        PROVIDER_CFDI_XML_ENCRYPTION_KEY: process.env.PROVIDER_CFDI_XML_ENCRYPTION_KEY,
      },
    },
    {
      name: "cfdi-worker-verify",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/scripts/start-worker.ts",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "",
        REDIS_URL: "",
        MASS_DOWNLOADS_REDIS_REQUIRE_AUTH: "true",
        INVOICE_XML_ENCRYPTION_KEY: process.env.INVOICE_XML_ENCRYPTION_KEY,
        PROVIDER_CFDI_XML_ENCRYPTION_KEY: process.env.PROVIDER_CFDI_XML_ENCRYPTION_KEY,
      },
    }
  ],
};
