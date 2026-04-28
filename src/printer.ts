/**
 * Printer — sends ZPL commands to the label printer.
 *
 * Uses CUPS (`lp` command) as the printing backend. The ZPL is sent as
 * raw printer data (bypassing CUPS filtering) using the `-o raw` flag.
 */

import { spawn } from 'child_process';
import { discoverPrinters, findFirstZebra, getPrinter } from './discovery';
import type { PrintResult, PrinterInfo } from './types';

// Re-export discovery functions
export { discoverPrinters, findFirstZebra, getPrinter };
export type { PrintResult, PrinterInfo };

/**
 * Printer instance representing a connected Zebra label printer.
 */
export class Printer {
  /** CUPS printer name */
  readonly name: string;
  /** Printer metadata */
  readonly info: PrinterInfo;
  /** Label dimensions in dots (at printer DPI) */
  readonly labelWidth: number;
  readonly labelHeight: number;
  readonly dpi: number;

  private constructor(info: PrinterInfo, labelWidth?: number, labelHeight?: number, dpi?: number) {
    this.name = info.name;
    this.info = info;
    this.labelWidth = labelWidth ?? 609;
    this.labelHeight = labelHeight ?? 1015;
    this.dpi = dpi ?? 203;
  }

  /**
   * Connect to a printer by name.
   *
   * @example
   * ```ts
   * const printer = await Printer.connect('ZTC-GK420d');
   * ```
   */
  static async connect(name: string, labelWidth?: number, labelHeight?: number, dpi?: number): Promise<Printer> {
    const info = await getPrinter(name);
    if (!info) {
      throw new Error(`Printer '${name}' not found`);
    }
    return new Printer(info, labelWidth, labelHeight, dpi);
  }

  /**
   * Auto-discover and connect to the first available Zebra printer.
   *
   * @example
   * ```ts
   * const printer = await Printer.auto();
   * ```
   */
  static async auto(labelWidth?: number, labelHeight?: number, dpi?: number): Promise<Printer> {
    const info = await findFirstZebra();
    if (!info) {
      throw new Error('No Zebra printers found');
    }
    return new Printer(info, labelWidth, labelHeight, dpi);
  }

  /**
   * Connect to the named printer, or auto-discover if no name given.
   *
   * @example
   * ```ts
   * const printer = await Printer.connect(); // auto-discover
   * ```
   */
  static async connectOrAuto(name?: string, labelWidth?: number, labelHeight?: number, dpi?: number): Promise<Printer> {
    if (name) return Printer.connect(name, labelWidth, labelHeight, dpi);
    return Printer.auto(labelWidth, labelHeight, dpi);
  }

  /**
   * Check that the printer is ready to accept jobs.
   */
  async isReady(): Promise<boolean> {
    const info = await getPrinter(this.name);
    return info?.status === 'idle' && info?.accepting === true;
  }

  /**
   * Print raw ZPL commands to the printer.
   *
   * @param zpl - The ZPL commands to send
   * @returns Print result with job ID
   *
   * @example
   * ```ts
   * await printer.print(zplCommands);
   * ```
   */
  async print(zpl: string): Promise<PrintResult> {
    return new Promise((resolve) => {
      const lp = spawn('lp', [
        '-d', this.name,
        '-o', 'raw',
        '-o', 'orientation-requested=3', // portrait
        '--',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      lp.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      lp.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      lp.on('close', (code: number | null) => {
        if (code === 0) {
          // Parse job ID from "request id is ZTC-GK420d-3 (0 file(s))"
          const match = stdout.match(/request id is (\S+)/);
          resolve({ success: true, jobId: match?.[1] ?? undefined });
        } else {
          resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
        }
      });

      lp.on('error', (err: Error) => {
        resolve({ success: false, error: err.message });
      });

      // Write ZPL to stdin
      lp.stdin.write(zpl);
      if (!zpl.endsWith('\n')) {
        lp.stdin.write('\n');
      }
      lp.stdin.end();
    });
  }

  /**
   * Print ZPL and wait for the job to complete (blocking).
   */
  async printAndWait(zpl: string, timeoutMs: number = 30000): Promise<PrintResult> {
    const result = await this.print(zpl);
    if (!result.success || !result.jobId) return result;

    // Poll until job completes
    const start = Date.now();
    const jobId = result.jobId;
    while (Date.now() - start < timeoutMs) {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execP = promisify(exec);
        const checkOutput = await execP(`lpstat -W completed -d ${this.name} 2>/dev/null | grep "${jobId}"`, { timeout: 2000 });

        if (checkOutput.stdout.includes(jobId)) {
          return result; // Job completed
        }
      } catch {
        // Job not yet in completed list
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return result; // Timed out but job was submitted
  }

  /**
   * Cancel a print job by ID.
   */
  async cancel(jobId: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execP = promisify(exec);
      await execP(`cancel ${jobId}`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
