export type Category = 'document' | 'presentation' | 'spreadsheet' | 'image' | 'pdf' | 'data' | 'archive'

export interface FormatInfo {
  id: string
  label: string
  category: Category
  extensions: string[]
}

export interface ConversionInfo {
  src: string
  dst: string
  quality: 'high' | 'good' | 'basic'
  notes: string
}

export interface ToolInfo {
  accepts: string[]
  combine: boolean
  min_files: number
}

export interface Capabilities {
  formats: FormatInfo[]
  inputs: string[]
  conversions: ConversionInfo[]
  unavailable: { src: string; dst: string; missing: string[] }[]
  limits: { max_files: number; max_file_mb: number; max_batch_mb: number; retention_minutes: number }
  tools: Record<string, ToolInfo>
}

export type TaskStatus = 'waiting' | 'converting' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export interface TaskOutput {
  id: string
  filename: string
  size: number
  format: string
  mime: string
}

export interface BatchTask {
  id: string
  op: string
  inputs: { id: string; name: string; format: string | null; size: number }[]
  target: string | null
  status: TaskStatus
  error: string | null
  attempts: number
  output: TaskOutput | null
}

export interface Batch {
  id: string
  token?: string
  kind: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  created_at: number
  expires_at: number
  total: number
  finished: number
  counts: Record<TaskStatus, number>
  progress: number
  current: string | null
  eta_seconds: number | null
  tasks: BatchTask[]
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : detail
    } catch {
      /* not json */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status)
  }
  return res.json() as Promise<T>
}

export async function fetchCapabilities(): Promise<Capabilities> {
  return json(await fetch('/api/formats'))
}

/** Upload files with real upload progress (fetch has no upload progress, so XHR is used). */
export function uploadBatch(
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Batch> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as Batch)
      else {
        const detail = (xhr.response && typeof xhr.response.detail === 'string' && xhr.response.detail) || `Upload failed (${xhr.status})`
        reject(new ApiError(detail, xhr.status))
      }
    }
    xhr.onerror = () => reject(new ApiError('Network error: could not reach the conversion service', 0))
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(form)
  })
}

export async function getBatch(id: string, token: string): Promise<Batch> {
  return json(await fetch(`/api/conversions/${id}`, { headers: { 'X-Batch-Token': token } }))
}

export async function cancelBatch(id: string, token: string): Promise<Batch> {
  return json(await fetch(`/api/conversions/${id}/cancel`, { method: 'POST', headers: { 'X-Batch-Token': token } }))
}

export async function deleteBatch(id: string, token: string): Promise<void> {
  const res = await fetch(`/api/conversions/${id}`, { method: 'DELETE', headers: { 'X-Batch-Token': token } })
  if (!res.ok && res.status !== 404) throw new ApiError('Could not delete batch', res.status)
}

export const fileUrl = (id: string, token: string, fileId: string) =>
  `/api/conversions/${id}/files/${fileId}?token=${encodeURIComponent(token)}`

export const zipUrl = (id: string, token: string) =>
  `/api/conversions/${id}/download-zip?token=${encodeURIComponent(token)}`
