/**
 * HTTP file streaming for the wallpapers routes: single-range GET/HEAD with
 * the `content-range` header the webserver's gzip filter keys on, and a
 * streamed `fs.createReadStream` body so a 30 GB video never buffers whole.
 * @module file-stream
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Parse failures, multi-range requests, and unsatisfiable ranges land here. */
const BYTE_UNITS = new Set(['bytes'])

interface ByteRange {
  readonly start: number
  readonly end: number
}

/**
 * Parse one `range` header into a bounded byte range.
 * @param header - the raw header, or undefined.
 * @param size - total resource size in bytes.
 * @returns the clamped range, `undefined` when absent (full body), and
 * `null` when the request is malformed or unsatisfiable (416).
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | undefined | null {
  if (header === undefined) return undefined
  const match = /^([!-~]+)=([0-9]*)-([0-9]*)(?:\s*,.*)?$/.exec(header.trim())
  if (match === null) return null
  const [, unit = '', rawStart = '', rawEnd = ''] = match
  if (!BYTE_UNITS.has(unit.toLowerCase())) return null
  // Multi-range requests are refused with 416 rather than partially honored:
  // a client asking for several ranges gets one clean failure it can retry
  // as single requests, never a silently wrong video segment.
  if (rawEnd.includes(',') || header.includes(',')) return null
  if (rawStart === '') {
    // Suffix form `-N`: the final N bytes.
    const suffix = Number.parseInt(rawEnd, 10)
    if (!Number.isInteger(suffix) || suffix <= 0 || size === 0) return null
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1 }
  }
  const start = Number.parseInt(rawStart, 10)
  if (!Number.isInteger(start) || start < 0 || start >= size) return null
  const end = rawEnd === '' ? size - 1 : Math.min(Number.parseInt(rawEnd, 10), size - 1)
  if (!Number.isInteger(end) || end < start) return null
  return { start, end }
}

/**
 * Serve one file from disk with single-range support, owning the whole
 * response lifecycle. Errors before headers answer 404/416; a mid-stream
 * failure destroys the socket, because headers are already sent.
 * @param req - the request whose `range` header and method steer the reply.
 * @param res - the response to write.
 * @param filePath - absolute path of the file to serve.
 * @param contentType - MIME type written on the reply.
 */
export function serveFileWithRanges(
  req: IncomingMessage, res: ServerResponse, filePath: string, contentType: string,
): void {
  const open = async (): Promise<void> => {
    let size: number
    try {
      const info = await stat(filePath)
      if (!info.isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      size = info.size
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    const range = parseByteRange(req.headers.range, size)
    if (range === null) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    const stream = createReadStream(filePath, {
      ...(range === undefined ? {} : { start: range.start, end: range.end }),
    })
    stream.on('error', () => {
      // After 200/206 the status line is gone; tearing the socket down is the
      // only honest signal left, and it is what a media player retries on.
      res.destroy()
    })
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': size,
        'accept-ranges': 'bytes',
      })
      res.end()
      stream.destroy()
      return
    }
    if (range === undefined) {
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': size,
        'accept-ranges': 'bytes',
      })
    } else {
      // `content-range` is also the gzip filter's skip signal: media bytes
      // must reach the browser untransformed or <video> rejects them.
      res.writeHead(206, {
        'content-type': contentType,
        'content-length': range.end - range.start + 1,
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'accept-ranges': 'bytes',
      })
    }
    stream.pipe(res)
  }
  void open().catch(() => {
    if (!res.headersSent) {
      res.writeHead(404)
      res.end()
    } else {
      res.destroy()
    }
  })
}
