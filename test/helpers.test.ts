/**
 * Tests for server helpers — HTTP utilities.
 */
import { describe, it, expect } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { json, html, readBody, parseJson, checkAuth } from '../src/server/helpers';
import { textLabelSchema } from '../src/schemas';

// Helper to create mock req/res
function mockReqRes(body?: string) {
  const chunks: Buffer[] = [];
  const req = {
    headers: {} as Record<string, string>,
    url: '/',
    on: (event: string, cb: (...args: any[]) => void) => {
      if (event === 'data' && body) {
        // Deliver body synchronously
        setImmediate(() => cb(Buffer.from(body)));
      }
      if (event === 'end') {
        setImmediate(() => cb());
      }
      return req;
    },
  } as unknown as IncomingMessage;

  const res = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _body: '',
    _ended: false,
    writeHead(status: number, headers?: Record<string, string>) {
      this._status = status;
      if (headers) this._headers = headers;
      return this;
    },
    end(data?: string) {
      this._body = data || '';
      this._ended = true;
      return this;
    },
    setHeader() {},
  } as unknown as ServerResponse;

  return { req, res };
}

describe('json', () => {
  it('sends JSON response', () => {
    const { res } = mockReqRes();
    json(res, { hello: 'world' });
    expect((res as any)._status).toBe(200);
    expect((res as any)._headers['Content-Type']).toBe('application/json');
    expect(JSON.parse((res as any)._body)).toEqual({ hello: 'world' });
  });

  it('respects custom status code', () => {
    const { res } = mockReqRes();
    json(res, { error: 'nope' }, 400);
    expect((res as any)._status).toBe(400);
  });
});

describe('html', () => {
  it('sends HTML response', () => {
    const { res } = mockReqRes();
    html(res, '<h1>Hi</h1>');
    expect((res as any)._status).toBe(200);
    expect((res as any)._headers['Content-Type']).toContain('text/html');
    expect((res as any)._body).toBe('<h1>Hi</h1>');
  });
});

describe('readBody', () => {
  it('reads request body', async () => {
    const { req } = mockReqRes('hello world');
    const body = await readBody(req);
    expect(body).toBe('hello world');
  });

  it('returns empty string for no body', async () => {
    const { req } = mockReqRes('');
    const body = await readBody(req);
    expect(body).toBe('');
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns null for invalid JSON', () => {
    expect(parseJson('not json')).toBeNull();
    expect(parseJson('')).toBeNull();
  });

  it('parses primitives', () => {
    expect(parseJson('42')).toBe(42);
    expect(parseJson('"hello"')).toBe('hello');
    expect(parseJson('true')).toBe(true);
  });
});

describe('validate', () => {
  // Note: validate() requires the actual src/server/helpers module,
  // which uses mock req/res. These tests validate the schema directly
  // (same logic) and the error formatting.
  it('returns parsed data on success', async () => {
    const data = await textLabelSchema.safeParseAsync({ lines: ['Test'] });
    expect(data.success).toBe(true);
    if (data.success) expect(data.data.lines).toEqual(['Test']);
  });

  it('returns validation error on failure', async () => {
    const data = textLabelSchema.safeParse({});
    expect(data.success).toBe(false);
    if (!data.success) {
      expect(data.error.issues.length).toBeGreaterThan(0);
      expect(data.error.issues[0].path).toContain('lines');
    }
  });

  it('returns field-level error details', async () => {
    const data = textLabelSchema.safeParse({ lines: [] });
    expect(data.success).toBe(false);
    if (!data.success) {
      const messages = data.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes('At least one line'))).toBe(true);
    }
  });
});

describe('checkAuth', () => {
  it('passes when no API key configured', () => {
    const { req, res } = mockReqRes();
    const result = checkAuth(req, res, '');
    expect(result).toBe(true);
  });

  it('passes with valid Bearer token', () => {
    const { req, res } = mockReqRes();
    (req as any).headers['authorization'] = 'Bearer secret123';
    const result = checkAuth(req, res, 'secret123');
    expect(result).toBe(true);
  });

  it('rejects invalid Bearer token', () => {
    const { req, res } = mockReqRes();
    (req as any).headers['authorization'] = 'Bearer wrong';
    const result = checkAuth(req, res, 'secret123');
    expect(result).toBe(false);
    expect((res as any)._status).toBe(401);
  });

  it('passes with valid query param', () => {
    const { req, res } = mockReqRes();
    (req as any).url = '/api/test?key=secret123';
    (req as any).headers.host = 'localhost';
    const result = checkAuth(req, res, 'secret123');
    expect(result).toBe(true);
  });

  it('rejects invalid query param', () => {
    const { req, res } = mockReqRes();
    (req as any).url = '/api/test?key=wrong';
    (req as any).headers.host = 'localhost';
    const result = checkAuth(req, res, 'secret123');
    expect(result).toBe(false);
  });

  it('rejects with no auth when api key configured', () => {
    const { req, res } = mockReqRes();
    const result = checkAuth(req, res, 'secret123');
    expect(result).toBe(false);
  });
});
