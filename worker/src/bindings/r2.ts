/** ContainerからのR2疎通確認を処理する。 */
export async function handleR2Request(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (request.method !== 'GET') {
    return Response.json({ detail: 'Method not allowed' }, { status: 405 })
  }

  if (url.pathname !== '/health') {
    return Response.json({ detail: 'Not found' }, { status: 404 })
  }

  try {
    const listed = await env.STORAGE.list({ limit: 1 })
    return Response.json({ status: 'ok', object_count: listed.objects.length })
  } catch {
    return Response.json({ detail: 'R2 is unavailable' }, { status: 503 })
  }
}
