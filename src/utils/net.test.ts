import { describe, it, expect } from 'vitest';
import { isLoopbackHost } from './net.js';

describe('isLoopbackHost', () => {
  it('returns true for [::1]', () => {
    expect(isLoopbackHost('[::1]')).toBe(true);
  });

  it('returns true for [::1]:3000', () => {
    expect(isLoopbackHost('[::1]:3000')).toBe(true);
  });

  it('returns true for ::1', () => {
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('returns true for 127.0.0.1', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
  });

  it('returns true for localhost', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
  });

  it('returns false for example.com', () => {
    expect(isLoopbackHost('example.com')).toBe(false);
  });
});
