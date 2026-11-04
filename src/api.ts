export class ApiError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) { super(message); this.details = details; }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch('/api'+path,{ ...options, headers:{ 'Content-Type':'application/json',...options?.headers } }); }
  catch { throw new ApiError('暂时无法连接本地服务，请检查服务是否仍在运行。'); }
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error || '请求失败，请重试。',body.details || []);
  return body as T;
}
export const send = (body: unknown): RequestInit => ({ method:'POST',body:JSON.stringify(body) });
