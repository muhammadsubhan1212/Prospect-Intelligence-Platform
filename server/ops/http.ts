export function jsonOk(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}
