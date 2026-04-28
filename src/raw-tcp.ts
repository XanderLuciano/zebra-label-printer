/**
 * Raw TCP passthrough — listens on port 9100 (Zebra standard)
 * and forwards any received ZPL data through the print queue.
 *
 * This makes the USB-connected printer appear as a standard network
 * Zebra printer to any software that supports TCP/IP printing:
 * Bartender, NiceLabel, ERP systems, Zebra Setup Utilities, etc.
 *
 * Protocol: Connect → send raw ZPL (ASCII) → disconnect → print happens.
 * Multiple lines accumulated within a short window are batched.
 */

import { createServer, type Socket } from 'net'
import type { PrintQueue } from './queue'
import type { Printer } from './printer'


const FLUSH_TIMEOUT_MS = 500 // ms to wait before assuming data is complete

interface PendingData {
  buffers: Buffer[]
  totalLength: number
}

/**
 * Start a raw TCP server on the given port.
 *
 * @param port - TCP port (default 9100 — standard Zebra network port)
 * @param host - Bind address (default '0.0.0.0')
 * @param getQueue - Accessor for the active PrintQueue
 * @param printer - The active Printer instance
 */
export function startRawTcpServer(
  port: number,
  host: string,
  getQueue: () => PrintQueue | null,
  printer: Printer
): ReturnType<typeof createServer> {
  const server = createServer((socket: Socket) => {
    const pending: PendingData = {
      buffers: [],
      totalLength: 0
    }

    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const peer = `${socket.remoteAddress}:${socket.remotePort}`

    const scheduleFlush = () => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = setTimeout(() => {
        flushTimer = null
        flushAndPrint(pending, getQueue, printer, peer, socket)
      }, FLUSH_TIMEOUT_MS)
    }

    socket.on('data', (data: Buffer) => {
      pending.buffers.push(data)
      pending.totalLength += data.length
      scheduleFlush()
    })

    socket.on('end', () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (pending.totalLength > 0) {
        flushAndPrint(pending, getQueue, printer, peer, socket)
      }
    })

    socket.on('error', (err: Error) => {
      if (flushTimer) clearTimeout(flushTimer)
      console.error(`TCP(9100) error from ${peer}: ${err.message}`)
    })
  })

  server.listen(port, host, () => {
    console.log(`   Raw TCP:  tcp://${host === '0.0.0.0' ? '0.0.0.0' : host}:${port} (Zebra network protocol)`)
  })

  server.on('error', (err: Error) => {
    console.error(`Raw TCP server error: ${err.message}`)
  })

  return server
}

async function flushAndPrint(
  pending: PendingData,
  getQueue: () => PrintQueue | null,
  printer: Printer,
  peer: string,
  _socket: Socket
): Promise<void> {
  if (pending.totalLength === 0) return

  const fullBuffer = Buffer.concat(pending.buffers, pending.totalLength)
  pending.buffers = []
  pending.totalLength = 0

  const zpl = fullBuffer.toString('utf-8').trim()
  if (!zpl) return

  const queue = getQueue()
  if (queue) {
    await queue.submit('zpl', { zpl, source: 'tcp9100', peer }, () => zpl)
    console.log(`   TCP(9100): Queued ${zpl.length}b from ${peer}`)
  } else {
    const result = await printer.print(zpl)
    if (result.success) {
      console.log(`   TCP(9100): Printed ${zpl.length}b from ${peer} (Job: ${result.jobId})`)
    } else {
      console.error(`   TCP(9100): Print failed for ${peer}: ${result.error}`)
    }
  }
}
