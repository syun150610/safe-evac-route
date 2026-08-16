/** ContainerからのD1疎通確認を処理する。 */
export async function handleD1Request(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (request.method !== 'GET') {
    return Response.json({ detail: 'Method not allowed' }, { status: 405 })
  }

  if (url.pathname !== '/health') {
    return Response.json({ detail: 'Not found' }, { status: 404 })
  }

  try {
    const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()

    if (row?.ok !== 1) {
      return Response.json({ detail: 'D1 is unavailable' }, { status: 503 })
    }

    return Response.json({ status: 'ok', result: row.ok })
  } catch {
    return Response.json({ detail: 'D1 is unavailable' }, { status: 503 })
  }
}
