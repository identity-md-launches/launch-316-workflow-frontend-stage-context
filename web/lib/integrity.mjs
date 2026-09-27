import { keccak256, toBytes } from 'viem';

// Canonical JSON: object keys sorted recursively, array order preserved.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function abiHash(abi) { return keccak256(toBytes(canonical(abi))).slice(2); }
export function safePath(path) {
  return typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path)
    && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..');
}
