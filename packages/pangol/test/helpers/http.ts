/// <reference types="node" />
// A raw HTTP client for adapter tests: node:http sends the request-target exactly as given (no URL
// normalization), and repeated headers as separate lines. Works on Node and on Bun.
import { request } from 'node:http'

export interface RawResponse { status: number; headers: Record<string, string | string[] | undefined>; body: string }

export function raw(port: number, method: string, path: string, headers: Record<string, string | string[]> = {}, body?: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}
