/** ContainerからのD1操作リクエストを処理する。 */
export async function handleD1Request(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  // GET /health
  if (request.method === 'GET' && url.pathname === '/health') {
    try {
      const row = await env.DATABASE.prepare('SELECT 1 AS ok').first<{ ok: number }>()
      if (row?.ok !== 1) {
        return Response.json({ detail: 'D1 is unavailable' }, { status: 503 })
      }
      return Response.json({ status: 'ok', result: row.ok })
    } catch {
      return Response.json({ detail: 'D1 is unavailable' }, { status: 503 })
    }
  }

  // POST /query — SELECT系。複数行を返す
  if (request.method === 'POST' && url.pathname === '/query') {
    try {
      const { sql, params = [] } = await request.json<{ sql: string; params?: unknown[] }>()
      const result = await env.DATABASE.prepare(sql).bind(...params).all()
      return Response.json({ results: result.results })
    } catch (err) {
      return Response.json({ detail: String(err) }, { status: 500 })
    }
  }

  // POST /execute — INSERT / UPDATE / DELETE系
  if (request.method === 'POST' && url.pathname === '/execute') {
    try {
      const { sql, params = [] } = await request.json<{ sql: string; params?: unknown[] }>()
      await env.DATABASE.prepare(sql).bind(...params).run()
      return Response.json({ success: true })
    } catch (err) {
      return Response.json({ detail: String(err) }, { status: 500 })
    }
  }

  return Response.json({ detail: 'Not found' }, { status: 404 })
}
