const issuer = 'http://127.0.0.1:8080/realms/pangol-test'
for (let attempt = 0; attempt < 90; attempt++) {
  try {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(1000) })
    if (response.ok) { console.log('Keycloak fixture is ready'); process.exit(0) }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000))
}
throw new Error('Keycloak did not become ready')
