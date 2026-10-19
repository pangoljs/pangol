// Defaults target only the loopback-bound demo containers. Override for your own deployment.
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://demo:demo-local-only@127.0.0.1:55432/pangol_demo',
  issuer: process.env.KEYCLOAK_ISSUER ?? 'http://127.0.0.1:8080/realms/pangol-demo',
  audience: process.env.KEYCLOAK_AUDIENCE ?? 'pangol-api',
}
