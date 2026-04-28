/**
 * Tests for route table and dispatch logic.
 */
import { describe, it, expect } from 'vitest';
import type { RouteTable } from '../../src/server/router';
import { findHandler, printRoutes } from '../../src/server/router';

import type { Handler } from '../../src/server/router';

const noopHandler: Handler = async (_req, _res, _printer) => {};

describe('router', () => {
  it('finds handler for exact method + path', () => {
    const routes: RouteTable = new Map();
    const get = new Map<string, Handler>();
    get.set('/api/health', noopHandler);
    routes.set('GET', get);

    const handler = findHandler(routes, 'GET', '/api/health');
    expect(handler).toBe(noopHandler);
  });

  it('returns null for unknown path', () => {
    const routes: RouteTable = new Map();
    const get = new Map<string, Handler>();
    get.set('/api/health', noopHandler);
    routes.set('GET', get);

    expect(findHandler(routes, 'GET', '/api/unknown')).toBeNull();
  });

  it('returns null for unknown method', () => {
    const routes: RouteTable = new Map();
    routes.set('GET', new Map([['/api/health', noopHandler]]));

    expect(findHandler(routes, 'POST', '/api/health')).toBeNull();
  });

  it('handles empty route table', () => {
    const routes: RouteTable = new Map();
    expect(findHandler(routes, 'GET', '/api/anything')).toBeNull();
  });

  it('supports multiple methods', () => {
    const routes: RouteTable = new Map();
    const getHandler: Handler = async () => {};
    const postHandler: Handler = async () => {};

    routes.set('GET', new Map([['/api/test', getHandler]]));
    routes.set('POST', new Map([['/api/test', postHandler]]));
    routes.set('PUT', new Map([['/api/test', noopHandler]]));

    expect(findHandler(routes, 'GET', '/api/test')).toBe(getHandler);
    expect(findHandler(routes, 'POST', '/api/test')).toBe(postHandler);
    expect(findHandler(routes, 'PUT', '/api/test')).toBe(noopHandler);
  });

  it('printRoutes does not throw', () => {
    const routes: RouteTable = new Map();
    routes.set('GET', new Map([['/a', noopHandler], ['/b', noopHandler]]));
    routes.set('POST', new Map([['/c', noopHandler]]));

    // Save and restore console.log
    const orig = console.log;
    const logs: string[] = [];
    console.log = (...args: any[]) => logs.push(args.join(' '));

    printRoutes(routes);

    console.log = orig;
    expect(logs.length).toBe(3);
    expect(logs.some(l => l.includes('GET') && l.includes('/a'))).toBe(true);
    expect(logs.some(l => l.includes('POST') && l.includes('/c'))).toBe(true);
  });
});
